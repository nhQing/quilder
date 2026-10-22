'use client';

/**
 * Trạng thái của editor.
 *
 * Cố ý giữ MỎNG ở giai đoạn này: chỉ những gì cả ba pane cùng cần biết —
 * node đang chọn, breakpoint đang xem, và doc ứng viên.
 *
 * `candidateDoc` là chỗ ops engine (Plan 3) và AI (Plan 4) sẽ ghi vào. Nguyên
 * tắc đã chốt: KHÔNG có đường auto-apply. Mọi thay đổi đi vào `candidateDoc`,
 * preview render từ đó, người duyệt rồi mới ghi thành `PageVersion`.
 */

import { create } from 'zustand';

import {
  DEFAULT_SCREENS,
  MAX_SCREEN_WIDTH,
  MIN_SCREEN_WIDTH,
  breakpointForWidth,
  type Breakpoint,
  type Screen,
} from '@/lib/design/breakpoints';
import type { Op } from '@/lib/doc/ops';
import type { Doc, NodeId } from '@/lib/doc/types';
import type { SaveState } from './save-state';
import { recordTiming } from './timing';
import { presetTreeToDoc } from '@/lib/doc/migrate';
import {
  MAX_SCREENS,
  defaultHeightFor,
  nextScreenId,
  normalizeScreens,
  readScreens,
  writeScreens,
} from './screens';

/**
 * Đích của mọi thao tác sửa.
 *
 * Trước đây store chỉ biết `pageId` và luôn POST vào `/api/ops`. Nhưng cây node
 * của component có ĐÚNG hình dạng `Doc` (xem `apply-to-preset.ts`), nên cả
 * editor — canvas, cây node, inspector, undo — chạy trên nó không sửa gì, miễn là
 * store biết gửi op đi đâu.
 *
 * Đó là cả lý do sửa component tại chỗ khả thi: không có editor thứ hai.
 */
export type EditTarget =
  | { kind: 'page'; id: string }
  | { kind: 'component'; id: string; name: string };

export interface EditorState {
  target: EditTarget | null;
  /** Doc đã lưu, nguồn để so sánh khi hiện diff. */
  savedDoc: Doc | null;
  /** Doc đang sửa. Bằng savedDoc khi chưa có thay đổi nào. */
  candidateDoc: Doc | null;

  selectedId: NodeId | null;
  /**
   * Phần tử BÊN TRONG instance mà lần bấm gần nhất rơi vào — hoặc `null`.
   *
   * Canvas trang chỉ chọn được cả Instance (node bên trong mang `data-cn`, không phải
   * `data-n`), nên `selectedId` vẫn là id instance. Nhưng chủ site bấm vào một cái nút
   * trong header là muốn sửa CÁI NÚT: nút "Copy link cho AI" cần biết phần tử đó để link
   * dẫn thẳng tới nó. Giữ ở một khoá riêng, không nhét vào `selectedId`, để mọi nơi đang
   * đọc `selectedId` (cây Lớp, inspector, NodeActions) không đổi nghĩa.
   *
   * Xoá ở MỌI lần chọn khác — kể cả chọn lại đúng instance đó từ cây Lớp, vì khi đó người
   * dùng đã chỉ vào cả instance chứ không phải phần tử bên trong.
   */
  selectedInner: { instanceId: NodeId; localId: string } | null;
  hoveredId: NodeId | null;
  /**
   * Yêu cầu CUỘN khung xem trước tới một node. `Canvas` là bên duy nhất đọc nó.
   *
   * ## Vì sao là một yêu cầu riêng, không suy ra từ `selectedId`
   *
   * Canvas kéo–phóng cũ suy ra: chọn đổi mà node nằm ngoài tầm nhìn thì kéo tới. Với
   * khung cuộn dọc thì phép suy đó sai ở hai chỗ:
   *
   *  - Bấm một section dài NGAY TRÊN canvas là chọn một node "không thấy trọn" — suy
   *    theo tầm nhìn thì khung nhảy lên đỉnh section dưới tay người dùng, đúng lúc họ
   *    vừa chỉ vào nó. Bấm trong canvas không bao giờ được cuộn.
   *  - Bấm lại ĐÚNG hàng đang chọn sau khi đã cuộn đi chỗ khác thì `selectedId` không
   *    đổi, nên không có gì để suy ra — trong khi đó chính là lúc người ta muốn quay về.
   *
   * Nên bên chọn NÓI RÕ: `select(id, { reveal: true })` từ cây Lớp, danh sách cảnh
   * báo, link `?node=`. Còn `seq` tăng ở mỗi yêu cầu để hai lần xin cùng một node là
   * hai yêu cầu, và để `Canvas` biết yêu cầu nào đã xử lý mà không phải xoá nó đi.
   *
   * `null` khi lần chọn gần nhất KHÔNG xin cuộn: chọn mới thắng một yêu cầu còn treo
   * (khung chưa nạp xong) — người dùng đã bấm sang chỗ khác thì không kéo họ về chỗ cũ.
   *
   * `exact`: node VỪA TẠO (Chèn ở pane Component) — chưa có trong khung đang hiện, chỉ có
   * trong bản server sẽ trả sau khi lưu. Canvas chờ đúng node đó xuất hiện thay vì lùi về
   * tổ tiên gần nhất (thứ đúng cho node ẩn, nhưng với node mới thì là cuộn tới gốc trang).
   */
  reveal: { id: NodeId; seq: number; exact?: boolean } | null;
  /**
   * Breakpoint đang xem — quyết định inspector ghi vào lớp nào.
   *
   * SUY RA từ bề rộng khung đang chọn, không đặt độc lập. Xem `setActiveScreen`.
   */
  breakpoint: Breakpoint;

  /**
   * Ngôn ngữ đang XEM và đang SỬA. `null` = bản gốc.
   *
   * Không phải một lựa chọn xem trước: bản dịch là LỚP PHỦ nội dung, nên ở một
   * ngôn ngữ khác bản gốc thì ô chữ/ảnh ghi vào bảng `Translation`, còn ô style bị
   * khoá. Xem `InspectorHead`.
   *
   * KHÔNG lưu vào localStorage, khác `screens`: mở lại builder mà vẫn ở chế độ
   * tiếng Anh từ hôm qua là cách chắc chắn để ai đó sửa nhầm bản dịch tưởng là
   * bản gốc. Mỗi lần mở trang bắt đầu ở bản gốc.
   */
  locale: string | null;

  /**
   * Các khổ màn giả lập, sắp giảm dần theo bề rộng. Không bao giờ rỗng.
   *
   * Đây là lựa chọn giao diện, lưu ở `localStorage` — không đi vào doc, không đi
   * vào release. Xem `src/lib/builder/screens.ts`.
   */
  screens: Screen[];
  /** Khung đang xem. Canvas hiện ĐÚNG MỘT khung mỗi lúc. */
  activeScreenId: string;

  /** Ngăn xếp op nghịch đảo. Mỗi phần tử hoàn tác đúng một batch. */
  undoStack: Op[][];
  redoStack: Op[][];

  /**
   * Trạng thái lưu — MỘT union, không phải hai boolean.
   *
   * Xem docblock của `save-state.ts`: hai biến rời cho hai kết cục là đúng lỗi đã
   * làm publish hỏng hiện chữ xanh. Ai cần "đang ghi không" thì dùng `selectSaving`.
   */
  save: SaveState;

  /**
   * `seq` của bản nháp mà client đang dựa vào — gửi kèm mọi batch làm `baseSeq`.
   *
   * Tách khỏi `save` vì `save` mất `seq` ở trạng thái `saving` và `error`, mà lúc thử
   * lại vẫn phải biết mình đang dựa trên bản nào. `null` ở chế độ sửa component (preset
   * chưa có `seq`) — khi đó server tự áp lên bản hiện tại. Xem `applyOpsToPage`.
   */
  draftSeq: number | null;

  /**
   * CSS của bản nháp vừa lưu, khi batch có đổi style — `Canvas` thay nó vào khung đang
   * hiện ngay, trước khi bản render đầy đủ của server về. `at` để effect chạy lại cả
   * khi hai lần lưu ra cùng một chuỗi CSS. Xem `ApplyResult.css`.
   */
  liveCss: { css: string; at: number } | null;

  init: (target: EditTarget, doc: Doc, seq: number | null) => void;
  /**
   * Server gửi một bản MỚI HƠN của cùng đối tượng đang sửa.
   *
   * Khác `init` ở đúng một điểm, và điểm đó là cả lý do nó tồn tại: nó KHÔNG xoá
   * hai ngăn xếp undo. `init` nghĩa là "đổi sang trang/component khác", nên xoá
   * lịch sử là đúng. Còn `router.refresh()` sau khi publish hay sau khi đóng chế độ
   * sửa component cũng đẩy một `doc` mới xuống — cùng trang, chỉ là bản mới hơn —
   * và gọi `init` ở đó là **xoá lịch sử undo ngay sau lần refresh ấy**, tức nút
   * Hoàn tác tắt ngóm đúng lúc người ta cần nó.
   */
  syncSaved: (doc: Doc) => void;
  /** Gửi lại batch op vừa trượt. Không làm gì nếu trạng thái không phải `error`. */
  retrySave: () => Promise<void>;
  /**
   * Chọn một node. `reveal: true` = chọn từ NGOÀI khung xem trước, cuộn khung tới
   * nó — xem `reveal`. Bấm trong canvas gọi KHÔNG có cờ này.
   */
  select: (id: NodeId | null, opts?: { reveal?: boolean | 'exact'; inner?: string | null }) => void;
  setLocale: (code: string | null) => void;
  hover: (id: NodeId | null) => void;
  reset: () => void;

  /**
   * Nạp danh sách khổ đã lưu. Gọi trong effect lúc mount, KHÔNG lúc render.
   *
   * `localStorage` không tồn tại trên server, nên đọc nó trong lúc render sẽ làm
   * HTML hai bên lệch nhau — cùng cái bẫy đã ghi ở `LeftPanel`.
   */
  hydrateScreens: () => void;
  /** Chọn khung đang xem; breakpoint tự đi theo bề rộng của nó. */
  setActiveScreen: (id: string) => void;
  addScreen: (width: number) => void;
  removeScreen: (id: string) => void;
  setScreenWidth: (id: string, width: number) => void;
  resetScreens: () => void;

  /** Gửi op lên server, cập nhật doc và ngăn xếp undo. */
  dispatch: (ops: Op[], opts?: { label?: string }) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** 409 từ /api/ops: bản nháp đã đổi ở nơi khác. `currentSeq` là bản hiện tại. */
class SaveConflict extends Error {
  constructor(
    message: string,
    readonly currentSeq: number | undefined,
  ) {
    super(message);
  }
}

async function postOps(
  target: EditTarget,
  ops: Op[],
  label: string | undefined,
  baseSeq: number | null,
): Promise<{ doc: Doc; undo: Op[]; seq: number | null; css?: string }> {
  const res =
    target.kind === 'page'
      ? await fetch('/api/ops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Không gửi `actor`: server suy ra từ phiên (xem /api/ops). Gửi thì cũng
          // bị bỏ qua — trường đó từng là chỗ lách allowlist của AI.
          body: JSON.stringify({
            pageId: target.id, ops, label,
            ...(typeof baseSeq === 'number' ? { baseSeq } : {}),
          }),
        })
      : await fetch(`/api/presets/${target.id}/ops`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops, label }),
        });

  const json = await res.json();
  if (res.status === 409 && json.conflict) {
    throw new SaveConflict(json.error ?? 'Bản nháp vừa đổi', json.currentSeq);
  }
  if (!res.ok) {
    const detail = Array.isArray(json.issues)
      ? json.issues.map((i: { message: string }) => i.message).join('; ')
      : json.error;
    throw new Error(detail || 'Không lưu được');
  }

  // Trang trả `doc`, component trả `tree` — cùng nội dung, khác tên trường.
  // Chuẩn hoá ở đây, một chỗ, và MIGRATE thay vì dán nhãn: `docToTree` ghi
  // `schemaVersion` vào cây, nên `{ ...tree, schemaVersion: 1 }` còn ĐÈ NGƯỢC
  // version thật về 1.
  const doc = (json.doc as Doc | undefined) ?? presetTreeToDoc(json.tree);

  // Đường component (`/api/presets/[id]/ops`) không có `seq` — `PresetVersion` chưa
  // có cột đó. `null` chứ không `0`: `0` sẽ hiện thành "v0".
  return {
    doc,
    undo: json.undo as Op[],
    seq: (json.seq as number | undefined) ?? null,
    ...(typeof json.css === 'string' ? { css: json.css as string } : {}),
  };
}

/**
 * Gửi một batch; trúng 409 thì áp lại ĐÚNG MỘT LẦN lên bản mới nhất.
 *
 * Vì sao tự áp lại được: op là Ý ĐỊNH theo `nodeId` ("đổi padding của node X"), không
 * phải bản vá theo vị trí, nên chạy lại trên bản mới thường vẫn đúng ý — và nếu node
 * đã bị xoá ở bên kia, `validateOps` từ chối với một câu nói rõ node nào. Undo trả về
 * từ lần gửi thứ hai được server tính trên bản mới, nên hoàn tác vẫn chính xác.
 *
 * Chỉ một lần: trúng 409 lần nữa nghĩa là bên kia đang sửa liên tục, và người dùng nên
 * thấy lỗi thay vì một vòng lặp đuổi nhau.
 */
async function postWithRebase(
  target: EditTarget,
  ops: Op[],
  label: string | undefined,
  baseSeq: number | null,
): Promise<{ doc: Doc; undo: Op[]; seq: number | null; css?: string; rebased: boolean }> {
  const started = typeof performance === 'undefined' ? 0 : performance.now();
  const done = <T,>(value: T): T => {
    if (started) recordTiming('save', performance.now() - started);
    return value;
  };
  try {
    return done({ ...(await postOps(target, ops, label, baseSeq)), rebased: false });
  } catch (error) {
    if (!(error instanceof SaveConflict) || typeof error.currentSeq !== 'number') throw error;
    return done({ ...(await postOps(target, ops, label, error.currentSeq)), rebased: true });
  }
}

/**
 * Số thứ tự của yêu cầu cuộn — chỉ tăng, KHÔNG về 0 khi `reveal` thành `null`.
 *
 * Đếm lại từ 0 thì yêu cầu kế tiếp mang lại một `seq` mà `Canvas` đã ghi là "xử lý
 * rồi", và nó bị bỏ qua im lặng — đúng kiểu lỗi chỉ lộ ra ở lần bấm thứ hai.
 */
let revealSeq = 0;

export const useEditor = create<EditorState>((set, get) => ({
  target: null,
  savedDoc: null,
  candidateDoc: null,
  selectedId: null,
  selectedInner: null,
  hoveredId: null,
  reveal: null,
  /*
   * Mặc định là khổ 1440 (lớp `lg`): người ta dựng ở desktop trước, dù dữ liệu lưu
   * mobile-first. Không lấy khổ rộng nhất (1920) vì ở mức đó phải thu nhỏ nhiều mới
   * vừa pane, còn 1440 gần với màn của chính người đang dựng.
   *
   * Giá trị khởi tạo là MẶC ĐỊNH, không phải bản đã lưu — bản đã lưu chỉ được nạp
   * trong effect (`hydrateScreens`), vì server không có `localStorage`.
   */
  breakpoint: 'lg',
  locale: null,
  screens: [...DEFAULT_SCREENS],
  activeScreenId: DEFAULT_SCREENS[1]!.id,
  undoStack: [],
  redoStack: [],
  save: { k: 'clean', seq: null },
  draftSeq: null,
  liveCss: null,

  init: (target, doc, seq) =>
    set({
      target, savedDoc: doc, candidateDoc: doc,
      undoStack: [], redoStack: [], save: { k: 'clean', seq }, draftSeq: seq, liveCss: null,
    }),

  /*
   * `syncSaved` KHÔNG chạm `save`.
   *
   * Nó chạy khi `router.refresh()` mang một `doc` mới của cùng trang về — tức SAU
   * một lần lưu đã thành công. Lúc đó `save` đã mang `seq` từ response của
   * `/api/ops`, và đó là con số mới nhất. Cho `syncSaved` ghi `seq` nữa là mở một
   * cửa sổ để một lần refresh chậm ghi số CŨ lên số mới, và chip nhảy lùi.
   */
  syncSaved: (doc) => set({ savedDoc: doc, candidateDoc: doc }),

  select: (id, opts) =>
    set({
      selectedId: id,
      selectedInner: id !== null && opts?.inner ? { instanceId: id, localId: opts.inner } : null,
      reveal:
        opts?.reveal && id !== null
          ? { id, seq: ++revealSeq, ...(opts.reveal === 'exact' ? { exact: true } : {}) }
          : null,
    }),
  setLocale: (code) => set({ locale: code }),
  hover: (id) => set({ hoveredId: id }),
  // `reveal` cũng đi: rời editor rồi quay lại thì `Canvas` mount mới, chưa xử lý yêu
  // cầu nào — một yêu cầu cũ còn nằm lại sẽ kéo khung tới node của lần trước.
  reset: () => set({ selectedId: null, selectedInner: null, hoveredId: null, reveal: null }),

  /* ── Khổ màn giả lập ─────────────────────────────────────────────────── */

  hydrateScreens: () => {
    const screens = readScreens();
    const { activeScreenId } = get();
    // Giữ khung đang chọn nếu nó còn trong danh sách vừa nạp; nếu không thì lấy khổ
    // gần 1440 nhất, chứ không lấy phần tử đầu — phần tử đầu là khổ RỘNG NHẤT, và
    // người dùng đổi máy sẽ mở ra ở 3840 nếu họ từng thêm khổ đó.
    const keep = screens.some((s) => s.id === activeScreenId);
    const active = keep
      ? activeScreenId
      : screens.reduce((best, s) =>
          Math.abs(s.width - 1440) < Math.abs(best.width - 1440) ? s : best,
        ).id;
    const width = screens.find((s) => s.id === active)!.width;
    set({ screens, activeScreenId: active, breakpoint: breakpointForWidth(width) });
  },

  setActiveScreen: (id) => {
    const screen = get().screens.find((s) => s.id === id);
    if (!screen) return;
    // Breakpoint LUÔN đi cùng bề rộng. Đặt rời hai thứ này là mở đường cho trạng
    // thái "đang xem 320px nhưng ghi vào lớp xl" — sửa xong không hiểu vì sao khung
    // không đổi gì.
    set({ activeScreenId: id, breakpoint: breakpointForWidth(screen.width) });
  },

  addScreen: (width) => {
    const { screens } = get();
    if (screens.length >= MAX_SCREENS) return;
    const w = Math.round(width);
    if (!Number.isFinite(w) || w < MIN_SCREEN_WIDTH || w > MAX_SCREEN_WIDTH) return;

    const screen: Screen = { id: nextScreenId(screens, w), width: w, height: defaultHeightFor(w) };
    const next = normalizeScreens([...screens, screen]);
    writeScreens(next);
    set({
      screens: next,
      activeScreenId: screen.id,
      breakpoint: breakpointForWidth(w),
    });
  },

  removeScreen: (id) => {
    const { screens, activeScreenId } = get();
    // Không cho xoá khổ cuối cùng: danh sách rỗng nghĩa là canvas không có gì để
    // hiện, và giao diện lúc đó không còn đường nào để thêm lại.
    if (screens.length <= 1) return;

    const next = screens.filter((s) => s.id !== id);
    writeScreens(next);
    const active = activeScreenId === id ? next[0]!.id : activeScreenId;
    set({
      screens: next,
      activeScreenId: active,
      breakpoint: breakpointForWidth(next.find((s) => s.id === active)!.width),
    });
  },

  setScreenWidth: (id, width) => {
    const w = Math.round(width);
    if (!Number.isFinite(w) || w < MIN_SCREEN_WIDTH || w > MAX_SCREEN_WIDTH) return;

    const { screens, activeScreenId } = get();
    const next = normalizeScreens(
      screens.map((s) => (s.id === id ? { ...s, width: w, height: defaultHeightFor(w) } : s)),
    );
    writeScreens(next);
    const active = next.find((s) => s.id === activeScreenId) ?? next[0]!;
    set({
      screens: next,
      activeScreenId: active.id,
      breakpoint: breakpointForWidth(active.width),
    });
  },

  resetScreens: () => {
    const next = [...DEFAULT_SCREENS];
    writeScreens(next);
    set({
      screens: next,
      activeScreenId: next[1]!.id,
      breakpoint: breakpointForWidth(next[1]!.width),
    });
  },

  dispatch: async (ops, opts) => {
    const { target } = get();
    if (!target || !ops.length) return false;

    set({ save: { k: 'saving' } });
    try {
      const { doc, undo, seq, rebased, css } = await postWithRebase(
        target, ops, opts?.label, get().draftSeq,
      );
      set((s) => ({
        savedDoc: doc,
        candidateDoc: doc,
        // Thao tác mới làm nhánh redo cũ vô nghĩa — giống mọi editor khác.
        undoStack: [...s.undoStack, undo],
        redoStack: [],
        save: rebased ? { k: 'clean', seq, rebased } : { k: 'clean', seq },
        draftSeq: seq,
        ...(css !== undefined ? { liveCss: { css, at: Date.now() } } : {}),
      }));
      return true;
    } catch (error) {
      // `retry: ops` — chính batch vừa trượt. Không giữ nó thì nút "thử lại" không
      // có gì để gửi, và người dùng phải làm lại thao tác bằng tay.
      set({
        save: {
          k: 'error',
          message: String(error instanceof Error ? error.message : error),
          retry: ops,
        },
      });
      return false;
    }
  },

  retrySave: async () => {
    const { save, dispatch } = get();
    if (save.k !== 'error') return;
    await dispatch(save.retry);
  },

  undo: async () => {
    const { target, undoStack } = get();
    const last = undoStack[undoStack.length - 1];
    if (!target || !last) return;

    set({ save: { k: 'saving' } });
    try {
      // Undo cũng đi qua đúng API và đúng validator — nó chỉ là một batch op
      // bình thường. Không có đường tắt nào ghi thẳng vào DB.
      const { doc, undo, seq, rebased, css } = await postWithRebase(target, last, 'undo', get().draftSeq);
      set((s) => ({
        savedDoc: doc, candidateDoc: doc,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, undo],
        save: rebased ? { k: 'clean', seq, rebased } : { k: 'clean', seq },
        draftSeq: seq,
        ...(css !== undefined ? { liveCss: { css, at: Date.now() } } : {}),
      }));
    } catch (error) {
      set({
        save: {
          k: 'error',
          message: String(error instanceof Error ? error.message : error),
          retry: last,
        },
      });
    }
  },

  redo: async () => {
    const { target, redoStack } = get();
    const last = redoStack[redoStack.length - 1];
    if (!target || !last) return;

    set({ save: { k: 'saving' } });
    try {
      const { doc, undo, seq, rebased, css } = await postWithRebase(target, last, 'redo', get().draftSeq);
      set((s) => ({
        savedDoc: doc, candidateDoc: doc,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, undo],
        save: rebased ? { k: 'clean', seq, rebased } : { k: 'clean', seq },
        draftSeq: seq,
        ...(css !== undefined ? { liveCss: { css, at: Date.now() } } : {}),
      }));
    } catch (error) {
      set({
        save: {
          k: 'error',
          message: String(error instanceof Error ? error.message : error),
          retry: last,
        },
      });
    }
  },
}));

/**
 * "Có một lần ghi đang bay không" — dùng để `disabled` các control.
 *
 * Mười bảy chỗ trong `components/builder/` cần đúng câu hỏi này, và không chỗ nào
 * cần biết THÊM gì về trạng thái lưu. Một selector có tên thay vì một trường
 * `saving` song song: hai trường là đúng thứ `save-state.ts` tồn tại để xoá.
 *
 * Trả `boolean` nên đẳng thức tham chiếu của zustand vẫn giữ — `LayerTree.tsx:74`
 * ghi rằng biến này làm cả 159 hàng re-render, và selector này không làm nó xấu hơn.
 */
export const selectSaving = (s: EditorState): boolean => s.save.k === 'saving';

/**
 * Ô STYLE có bị khoá không — đang lưu, HOẶC đang sửa một bản dịch.
 *
 * ## Vì sao bản dịch khoá style
 *
 * Bản dịch là lớp phủ NỘI DUNG (xem model `Translation`): một cây node, một bộ
 * style, dùng chung mọi ngôn ngữ. Đó là cả lý do chọn lớp phủ thay vì fork —
 * bố cục không bao giờ lệch giữa các bản.
 *
 * Nên ở chế độ tiếng Anh, kéo một ô padding sẽ ghi vào doc GỐC và đổi luôn trang
 * tiếng Việt. Người kéo không có cách nào biết: canvas đang hiện bản tiếng Anh,
 * và thay đổi trông đúng ý họ. Đó là lỗi im lặng, và nó sửa vào thứ họ không mở.
 *
 * Khoá ở MỘT selector chứ không ở từng ô: 34 ô trong Inspector, và ô nào quên là
 * ô đó thành lỗ hổng.
 */
export const selectStyleLocked = (s: EditorState): boolean =>
  s.save.k === 'saving' || s.locale !== null;
