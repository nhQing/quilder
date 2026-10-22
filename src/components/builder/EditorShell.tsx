'use client';

/**
 * Bố cục ba pane: cấu trúc | xem trước | thuộc tính.
 *
 * Mọi thay đổi đi qua `dispatch(ops)` → POST /api/ops → validator 4 tầng →
 * PageVersion mới. Không có đường ghi tắt. Undo/redo cũng chỉ là batch op đi
 * qua đúng đường đó, nên chúng không thể tạo ra trạng thái mà validator từ chối.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useEditor } from '@/lib/builder/store';
import { cn } from '@/lib/builder/cn';
import { isTypingTarget } from '@/lib/builder/dom';
import { readFlag, safeStorage, STORAGE_KEYS, write } from '@/lib/builder/persisted';
import type { ComponentTrees } from '@/lib/builder/text-units';
import type { Doc } from '@/lib/doc/types';
import type { EndpointTable } from '@/lib/doc/endpoint-table';
import { presetTreeToDoc } from '@/lib/doc/migrate';
import type { PageSummary, PresetSummary, TokenOption } from '@/lib/builder/queries';
import { publishLook } from '@/lib/builder/publish-label';
import { ui } from '@/lib/builder/ui';
import { BottomDock } from './BottomDock';
import { Canvas } from './Canvas';
import { ComponentNotice, EditorTopbar } from './EditorTopbar';
import { Inspector } from './Inspector';
import { PaneResizer, useRightPaneWidth } from './PaneResizer';
import type { LocaleOption } from './InspectorHead';
import type { DraftTranslation } from '@/lib/i18n/queries';
import type { PageSeo } from './PageSeoPanel';
import { LeftPanel } from './LeftPanel';
import { PageShare } from './PageShare';
import { AiLinkProvider } from './AiLinkProvider';
import { Button, buttonClass, Spinner } from './ui/Button';
import { Icon } from './ui/Icon';
import { Toast, ToastRegion } from './ui/Overlay';

export function EditorShell({
  pageId,
  slug,
  title,
  doc,
  seq,
  baseSeq,
  pages,
  presets,
  tokens,
  components,
  locales,
  translations,
  seo,
  siteUrl,
  endpoints,
}: {
  pageId: string;
  slug: string;
  title: string;
  doc: Doc;
  /** Số phiên bản của bản nháp đang mở — chip trạng thái lưu hiện nó. */
  seq: number | null;
  /** `seq` của bản đang chạy trên site. `null` = trang chưa publish lần nào. */
  baseSeq: number | null;
  pages: PageSummary[];
  presets: PresetSummary[];
  tokens: TokenOption[];
  /**
   * Cây component mà doc đang tham chiếu.
   *
   * Truyền xuống chứ không fetch ở client: inspector cần nó ngay lúc chọn một
   * instance, và một round-trip ở đó sẽ làm bảng thuộc tính nhấp nháy.
   */
  components: ComponentTrees;
  /** Ngôn ngữ ĐÃ BẬT của site, mặc định lên trước. */
  locales: LocaleOption[];
  /** Bản dịch nháp của trang, theo mã ngôn ngữ. */
  translations: Record<string, DraftTranslation[]>;
  /** Metadata SEO của trang — khối "Trang" ở đáy pane phải. */
  seo: PageSeo;
  /** `SITE_URL` của server — gốc của link "trên site" trong nút Chia sẻ. `null` = chưa đặt. */
  siteUrl: string | null;
  /** Bảng `Site.globals.endpoint` — ô "Gửi tới" của Form trong Inspector. */
  endpoints: EndpointTable;
}) {
  const router = useRouter();
  const init = useEditor((s) => s.init);
  const candidateDoc = useEditor((s) => s.candidateDoc);
  // `saving` / `lastError` / hai stack undo giờ đọc trong `EditorTopbar` — chỗ duy
  // nhất hiện chúng. Ở đây chỉ còn hai hàm mà phím tắt Ctrl+Z cần gọi.
  const syncSaved = useEditor((s) => s.syncSaved);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const save = useEditor((s) => s.save);
  const target = useEditor((s) => s.target);
  const locale = useEditor((s) => s.locale);

  const [publishing, setPublishing] = useState(false);
  // `{ ok, text }` chứ không phải một chuỗi trần: bản trước dùng CHUNG một state
  // cho cả thành công lẫn thất bại rồi luôn render bằng `text-shell-ok`, nên
  // publish hỏng vẫn hiện chữ xanh lá 10px và người dùng tưởng đã xong. Cùng mẫu
  // với `ReleaseTimeline`.
  const [published, setPublished] = useState<{ ok: boolean; text: string } | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  /**
   * Đang sửa component nào, hay đang sửa trang.
   *
   * Giữ ở đây chứ không đẩy sang một route riêng: chuyển route sẽ mất vị trí
   * cuộn của canvas, mất mức phóng, mất node đang chọn — và người dùng vào chế
   * độ này để sửa MỘT chi tiết rồi quay ra ngay, nên mất bối cảnh là mất phần
   * lớn giá trị.
   */
  const [editing, setEditing] = useState<{ id: string; name: string; doc: Doc } | null>(null);
  const [loadingComponent, setLoadingComponent] = useState(false);
  const [componentError, setComponentError] = useState<string | null>(null);

  /**
   * Pane trái thu về dải mỏng.
   *
   * State ở ĐÂY chứ không ở `LeftPanel` vì bề rộng là một cột của lưới shell —
   * `LeftPanel` không với tới được nó. `LeftPanel` nhận `collapsed` và nút bật/tắt.
   *
   * Mặc định là MỞ, và chỉ đổi sau khi đọc được lựa chọn đã lưu: bắt đầu ở trạng
   * thái thu gọn rồi bung ra là một cú giật layout ngay khi trang vừa hiện.
   */
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Bề rộng Inspector kéo được (21/10/2026) — xem `PaneResizer`.
  const gridRef = useRef<HTMLDivElement>(null);
  const rightPane = useRightPaneWidth();

  useEffect(() => {
    const stored = readFlag(safeStorage(), STORAGE_KEYS.leftCollapsed);
    if (stored !== null) setLeftCollapsed(stored);
  }, []);

  const toggleLeft = () => {
    setLeftCollapsed((v) => {
      write(safeStorage(), STORAGE_KEYS.leftCollapsed, v ? '0' : '1');
      return !v;
    });
  };

  /*
   * `init` CHỈ khi đổi đối tượng sửa; `doc` mới của cùng đối tượng thì `syncSaved`.
   *
   * `init` xoá hai ngăn xếp undo, và effect này chạy lại mỗi lần `doc` đổi THAM
   * CHIẾU — kể cả khi vẫn là trang đó, chỉ mới hơn một phiên bản. Mà `router.refresh()`
   * chạy sau khi publish và sau khi đóng chế độ sửa component — mỗi lần đó đẩy một
   * `doc` mới xuống. Kết quả: sửa một dòng chữ xong là nút Hoàn tác tắt, và
   * người dùng mất đúng bước vừa làm — thứ họ có nhiều khả năng muốn lùi nhất.
   *
   * Bắt được nhờ `content-panel.spec.ts`: nó ghi một dòng chữ, chờ `/render/:id` trả
   * về chữ mới (tức đã lưu XONG, tức refresh đã kịp về), rồi bấm Hoàn tác — và bấm
   * vào một nút `disabled`.
   */
  const targetKey = editing ? `component:${editing.id}` : `page:${pageId}`;
  const lastTarget = useRef<string | null>(null);

  useEffect(() => {
    const nextDoc = editing ? editing.doc : doc;
    if (lastTarget.current === targetKey) {
      syncSaved(nextDoc);
      return;
    }
    lastTarget.current = targetKey;
    if (editing) {
      init({ kind: 'component', id: editing.id, name: editing.name }, editing.doc, null);
    } else {
      init({ kind: 'page', id: pageId }, doc, seq);
    }
  }, [doc, pageId, seq, editing, init, syncSaved, targetKey]);

  // Dọn khi RỜI editor, không phải mỗi lần `doc` đổi — cleanup của effect trên sẽ
  // chạy sau mọi lần đổi tham chiếu, và `reset()` ở đó xoá luôn node đang chọn.
  useEffect(() => () => useEditor.getState().reset(), []);

  /**
   * Vào chế độ sửa component: nạp cây rồi trỏ store sang nó.
   *
   * ## Hai lỗi im lặng đã sửa ngày 20/08/2026
   *
   *  1. `loadingComponent` được đặt nhưng KHÔNG render ở đâu cả — state chết. Bấm "Sửa"
   *     rồi ngồi chờ khoảng 2 giây (đo được: fetch preset + đổi cả doc của store + iframe
   *     nạp lại) mà giao diện không nói gì. Hai giây im lặng sau một cú bấm là hai giây
   *     người dùng nghĩ nút hỏng, và họ sẽ bấm lại.
   *  2. `if (!res.ok) return;` — thất bại tuyệt đối im lặng. Preset bị xoá, phiên hết
   *     hạn, hay server 500 đều cho cùng một kết quả: không có gì xảy ra, không lời giải
   *     thích. Đó là loại lỗi đắt nhất, vì người dùng không có gì để báo lại.
   */
  const openComponent = async (componentId: string, opts?: { push?: boolean }) => {
    setLoadingComponent(true);
    setComponentError(null);
    try {
      const res = await fetch(`/api/presets/${componentId}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setComponentError(data.error ?? `Không mở được component (${res.status})`);
        return;
      }
      const { preset } = (await res.json()) as {
        preset: { id: string; name: string; tree: { rootId: string; nodes: object } };
      };
      setEditing({
        id: preset.id,
        name: preset.name,
        // Migrate, không dán nhãn: cây có thể ở version cũ hơn code. Xem
        // `presetTreeToDoc`.
        doc: presetTreeToDoc(preset.tree),
      });
      /*
       * Vào từ pane ("Sửa") thì để lại MỘT mục lịch sử: trước 16/10/2026 chế độ sửa
       * component chỉ là state, nên nút Back của trình duyệt rời luôn editor về trang
       * trước đó (thường là trang chủ builder) thay vì về trang đang sửa. Giờ Back = thoát
       * component — xem `popstate` bên dưới. `honoured` chốt trước: `?component=` vừa
       * đẩy vào URL không được kích hoạt lại effect mở-từ-URL.
       */
      if (opts?.push) {
        honoured.current = true;
        window.history.pushState({ mmComponent: componentId }, '', `${window.location.pathname}?component=${componentId}`);
      }
    } catch {
      setComponentError('Mất kết nối khi mở component');
    } finally {
      setLoadingComponent(false);
    }
  };

  /** "Sửa" ở pane trái / "Sửa component" ở Inspector: có mục lịch sử để Back quay về trang. */
  const editFromPane = (componentId: string) => void openComponent(componentId, { push: true });

  /**
   * `?component=<id>` — vào thẳng chế độ sửa component từ thư viện.
   *
   * Thư viện component không có trang nào đang mở, mà canvas thì phải đứng trên
   * một trang. Nên đường đi là: mở một trang bất kỳ rồi lập tức trỏ store sang
   * cây component — đúng thứ nút "Sửa component" trong pane phải vẫn làm, chỉ
   * khác là kích hoạt từ URL.
   *
   * Chỉ chạy MỘT lần: không chốt lại thì bấm "← Quay lại trang" sẽ bị effect này
   * mở lại ngay, và nút thoát trở thành nút không có tác dụng.
   */
  const search = useSearchParams();
  const requested = search.get('component');
  const honoured = useRef(false);
  useEffect(() => {
    if (!requested || honoured.current) return;
    honoured.current = true;
    void openComponent(requested);
  }, [requested]);

  /**
   * Link "Copy link cho AI": `?node=` (+ `cn`, `component`, `locale`).
   *
   * Đọc MỘT lần lúc mở (cùng mẫu `?component=` ở trên): chụp vào ref ở lần render đầu, vì
   * ngay sau khi dùng ta xoá tham số khỏi URL và `useSearchParams` sẽ trả `null` — nếu đọc
   * lại mỗi render thì effect thấy link "biến mất" giữa chừng.
   *
   * Hai đường, vì đích khác tầng:
   *  - Link trang: chọn node (kèm `cn` nếu trỏ vào phần tử trong instance) ngay khi store đã
   *    có doc.
   *  - Link component: mở component TRƯỚC (`openComponent` ở trên), chọn node sau khi cây
   *    component đã nạp — node id ở link này là id LOCAL, không có trong doc của trang.
   *
   * Không thấy node → thông báo không chặn, không ném: link có thể cũ (node đã xoá) và người
   * dùng vẫn cần editor dùng được.
   */
  const pendingLink = useRef<{
    node: string;
    cn: string | null;
    component: string | null;
    locale: string | null;
  } | null | undefined>(undefined);
  if (pendingLink.current === undefined) {
    const node = search.get('node');
    pendingLink.current = node
      ? { node, cn: search.get('cn'), component: search.get('component'), locale: search.get('locale') }
      : null;
  }
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  /** Bỏ tham số link khỏi URL. `component` ở lại khi đang sửa component — xem `closeComponent`. */
  const stripLinkParams = (keepComponent: boolean) => {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['node', 'cn', 'locale']) q.delete(k);
    if (!keepComponent) q.delete('component');
    const qs = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  };

  /*
   * Link TRANG không có chốt "đã làm": effect `[]` chỉ chạy lúc mount, và chạy lại thì
   * phải CHỌN LẠI. Strict Mode (dev) mount → dọn → mount lại; lượt dọn chạy `reset()` của
   * effect "rời editor" ở trên, xoá node vừa chọn. Một chốt ref (sống qua lượt dọn đó)
   * làm lượt mount lại bỏ qua — đo được: mở link bằng điều hướng phía client (nút "Mở" ở
   * Cài đặt) ra editor trống, dù tải thẳng URL thì chọn đúng.
   */
  const linkDone = useRef(false);
  useEffect(() => {
    const link = pendingLink.current;
    if (!link || link.component) return;

    // Chỉ nhận ngôn ngữ đã bật và không phải bản gốc; mã lạ thì ở lại bản gốc.
    if (link.locale && locales.some((l) => l.code === link.locale && !l.isDefault)) {
      useEditor.getState().setLocale(link.locale);
    }

    const target = doc.nodes[link.node];
    if (!target) {
      setLinkNotice('Không thấy element trong bản nháp hiện tại — có thể nó đã bị xoá. Copy lại link mới.');
    } else {
      // `cn` chỉ có nghĩa khi node là Instance và component có phần tử đó.
      const innerOk =
        link.cn !== null &&
        target.type === 'Instance' &&
        Boolean(components.get(target.componentId)?.nodes[link.cn]);
      useEditor.getState().select(link.node, { reveal: true, inner: innerOk ? link.cn : null });
      if (link.cn && !innerOk) {
        setLinkNotice('Không thấy phần tử bên trong component — đã chọn cả component.');
      }
    }
    stripLinkParams(false);
    // Chạy đúng một lần lúc mở; `doc`/`components` đổi sau đó không được kéo selection về.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const link = pendingLink.current;
    if (!link?.component || linkDone.current) return;
    if (componentError) {
      linkDone.current = true;
      stripLinkParams(true);
      return;
    }
    if (!editing || editing.id !== link.component) return;
    linkDone.current = true;
    if (editing.doc.nodes[link.node]) {
      useEditor.getState().select(link.node, { reveal: true });
    } else {
      setLinkNotice('Không thấy element trong component hiện tại — có thể nó đã bị xoá. Copy lại link mới.');
    }
    stripLinkParams(true);
  }, [editing, componentError]);

  /** Ra khỏi chế độ sửa component, và nạp lại trang để thấy thay đổi. */
  const leaveComponent = () => {
    setEditing(null);
    // Trang render component qua `[data-c]`, nên sửa component KHÔNG đổi doc của
    // trang — nhưng iframe phải nạp lại để lấy CSS và nội dung mới.
    router.refresh();
    setFrameKey((k) => k + 1);
  };

  /*
   * Back/Forward của trình duyệt khớp với chế độ sửa component.
   *
   * Mục lịch sử do "Sửa" ở pane đẩy vào (xem `openComponent`) mang `?component=`. Lùi
   * khỏi nó → thoát component; tiến lại vào nó → mở lại. Ref vì listener đăng ký một lần
   * mà `editing`/`openComponent` đổi mỗi render.
   */
  const live = useRef({ editing, openComponent, leaveComponent });
  live.current = { editing, openComponent, leaveComponent };
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get('component');
      const { editing: now, openComponent: open, leaveComponent: leave } = live.current;
      if (!id && now) leave();
      else if (id && !now) void open(id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const closeComponent = () => {
    // Vào bằng "Sửa" ở pane → lùi đúng mục lịch sử đã đẩy, để Back sau đó không quay
    // lại component. `popstate` ở trên làm phần còn lại.
    if ((window.history.state as { mmComponent?: string } | null)?.mmComponent) {
      window.history.back();
      return;
    }
    // Bỏ `?component=` khỏi URL: để nguyên thì F5 hoặc chia sẻ link sẽ quay lại
    // chế độ sửa component, còn thanh địa chỉ thì nói dối về chỗ đang đứng.
    //
    // `history.replaceState`, không `router.replace`. `router.replace` là một lượt
    // điều hướng: server render lại màn này, rồi `router.refresh()` ngay dưới render
    // thêm lần nữa, và URL chỉ đổi khi CẢ HAI xong — đo được 2–4s ở máy rảnh, quá 5s
    // khi máy bận, nên `components.spec.ts` thấy `?component=` còn nguyên. Next 15 đồng
    // bộ `replaceState` với `useSearchParams`, nên URL đổi ngay và chỉ còn một lượt
    // refresh.
    if (requested) window.history.replaceState(null, '', `/builder/${pageId}`);
    leaveComponent();
  };

  // Preview là iframe render từ server, nên sau mỗi lần lưu phải nạp lại nó.
  // Render phía client từ candidateDoc sẽ nhanh hơn, nhưng lúc đó preview không
  // còn là "đúng thứ server sẽ trả về" — và đó mới là thứ cần nhìn thấy.
  //
  // Bỏ qua lần ĐẦU (null → doc lúc store được init): iframe vừa nạp đúng bản đó từ
  // server rồi. Trước 08/10/2026 lần này cũng tăng token, nên mở editor là nạp canvas
  // HAI lần — đo được trên trang chủ: ~1,2 giây render thừa mỗi lần mở.
  const sawDoc = useRef(false);
  useEffect(() => {
    if (!candidateDoc) return;
    if (!sawDoc.current) {
      sawDoc.current = true;
      return;
    }
    setFrameKey((k) => k + 1);
  }, [candidateDoc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      // Đang gõ trong ô nhập thì Ctrl+Z thuộc về Ô ĐÓ. Bản trước bắt trên
      // `window` mà không kiểm gì, nên gõ dở trong panel CSS rồi nhấn Ctrl+Z sẽ
      // hoàn tác một PageVersion trên server thay vì hoàn tác chữ vừa gõ —
      // người dùng mất thao tác đang làm và không hiểu vì sao.
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) void redo();
      else void undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const active = candidateDoc ?? doc;

  /**
   * Publish ĐÚNG TRANG NÀY, không phải cả site.
   *
   * Nút này từng gửi `{ action: 'publish' }` trần, tức đẩy bản nháp của MỌI trang
   * lên cùng lúc. Người dùng sửa một trang, bấm Publish trên chính trang đó, và
   * chín trang nháp dở khác lên sóng theo — không có gì trên màn hình nói ra điều
   * đó. Giờ nó gửi `pageIds: [pageId]`; `/api/publish` dựng release mới bằng bản
   * nháp của trang này cộng bản ĐANG CHẠY của tất cả trang khác, nên release vẫn
   * là một ảnh chụp đầy đủ và lùi bản vẫn lùi được cả site.
   *
   * Publish cả site vẫn còn, nhưng đã dời sang trang Lịch sử publish — chỗ mà
   * người ta đến khi đang nghĩ về cả site, chứ không phải chỗ cách nút "Xem nháp"
   * 8px lúc đang sửa một dòng chữ.
   */
  const publish = async () => {
    // Publish là thao tác DUY NHẤT mà khách nhìn thấy ngay lập tức, và trước đây
    // là thao tác duy nhất không hỏi lại — trong khi xoá một node, thu hồi token
    // hay lùi bản đều có xác nhận. Nút lại nằm cách "Xem nháp" 8px.
    /*
     * `hasUnpublishedChanges` so `draftVersionId` với bản live, tức nó CHỈ thấy
     * thay đổi ở cây node của trang. Sửa component (`Preset.tree`) hay sửa bản
     * dịch (`Translation`) không đụng tới nó, nhưng cả hai đều được chụp vào
     * release lúc publish và đều lên site — xem mục 3.10 của HANDOFF.
     *
     * Nên câu "trang này không có gì thay đổi" không được nói trần: đúng vào lúc
     * người dùng vừa sửa một component, nó mời họ bỏ qua trong khi thay đổi của
     * họ sẽ lên site thật.
     */
    const changed = pages.find((p) => p.id === pageId)?.hasUnpublishedChanges ?? true;
    const ok = confirm(
      `Publish trang /${slug} lên site thật?\n\n`
        + (changed
          ? ''
          : 'Cây node của TRANG này không đổi so với bản đang chạy — nhưng thay đổi ở '
            + 'component hoặc bản dịch không được tính ở đây và vẫn sẽ lên site.\n\n')
        + 'Các trang khác giữ nguyên bản đang chạy; bản nháp của chúng vẫn là nháp.\n'
        + 'Component, token và dữ liệu chung dùng chung cho cả site, nên sửa ở đó sẽ lên '
        + 'sóng cho mọi trang.\n\n'
        + 'Khách sẽ thấy ngay lập tức. Lùi lại được ở Lịch sử publish.',
    );
    if (!ok) return;

    setPublishing(true);
    setPublished(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish', pageIds: [pageId] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Publish thất bại');
      setPublished({ ok: true, text: `Đã publish /${slug} trong ${json.ms}ms` });
      router.refresh();
    } catch (error) {
      setPublished({ ok: false, text: String(error instanceof Error ? error.message : error) });
    } finally {
      setPublishing(false);
    }
  };

  /*
   * `seq` cuối cùng BIẾT CHẮC, giữ qua các quãng `saving` và `error`.
   *
   * Không rơi về prop `seq`: prop đó là số LÚC TẢI TRANG, và `syncSaved` cố ý không cập nhật
   * `save.seq` từ một lần `router.refresh()` — xem docblock của nó. Rơi về prop nghĩa là mở
   * lại đúng cửa sổ mà docblock ấy cảnh báo: lần sửa thứ hai bắt đầu trước khi refresh của
   * lần đầu về, và con số lùi 1 rồi nhảy tiến 2.
   *
   * `&& !editing` làm ref chỉ theo seq của TRANG. Không có nó, một lần lưu component đang bay
   * sẽ để nút hiện số của trang trong khi người dùng đang sửa thứ khác.
   *
   * `target?.kind === 'page' && target.id === pageId` chặn việc GHI seq của một trang khác
   * vào ref (dispatch của trang A còn bay lúc chuyển sang B, response về sau khi `pageId`
   * đã là B nhưng trước khi effect `init` của B trỏ `target` sang B).
   *
   * Nhưng ghi đúng chưa đủ — ref còn phải biết seq nó đang giữ THUỘC VỀ TRANG NÀO, vì
   * `EditorShell` không unmount khi chuyển /builder/A → /builder/B (cùng route segment):
   * ref sống sót qua cú chuyển, còn `pageId`/`baseSeq` đã nhảy sang B ngay khi prop mới tới,
   * trước khi effect `init` của B kịp chạy (effect luôn chạy SAU paint). Nếu chỉ đọc
   * `lastSeq.current` mà không kiểm nó có phải của B không, mọi lần chuyển trang đều có
   * (các) lần render hiện số ghép từ seq CỦA A với `baseSeq` CỦA B. Nhánh đọc dưới đây so
   * `pageId` lưu trong ref với `pageId` hiện tại; lệch thì rơi về prop `seq` — số đó đúng
   * cho B tại thời điểm tải, nên vẫn đúng hơn là hiện `null` hay số của A.
   */
  const lastSeq = useRef<{ pageId: string; seq: number | null }>({ pageId, seq });
  if (save.k === 'clean' && !editing && target?.kind === 'page' && target.id === pageId) {
    lastSeq.current = { pageId, seq: save.seq };
  }
  const savedSeq = editing
    ? null
    : lastSeq.current.pageId === pageId
      ? lastSeq.current.seq
      : seq;
  const pub = publishLook({ seq: savedSeq, baseSeq });

  return (
    <AiLinkProvider
      doc={active}
      pageId={pageId}
      pageTitle={title}
      components={components}
      presets={presets}
      editing={editing ? { id: editing.id, name: editing.name } : null}
    >
    {/*
     * Cao đúng phần màn còn lại trong khung vỏ.
     *
     * `--shell-nav` là phần chiều cao KHÔNG thuộc về trang — từ giao diện v2 là đệm
     * trên + dưới của khung (xem builder.css). `h-screen` từng đẩy phần đó ra ngoài đáy
     * màn, và thứ bị đẩy ra là hàng cuối của pane trái cùng thanh `NodeActions`.
     * `100svh` chứ không `100vh`: trên mobile `vh` tính theo thanh địa chỉ lúc đã co,
     * nên canvas cao hơn khung thật.
     *
     * Bốn khối — thanh công cụ, pane trái, canvas, pane phải — là các panel nổi cách
     * nhau `gap-3`, cùng nhịp với khe giữa thanh menu và nội dung.
     */}
    <div className="flex h-[calc(100svh_-_var(--shell-nav,3rem))] flex-col gap-3">
      <EditorTopbar
        backHref="/builder"
        // Khác chữ nút "Quay lại trang" ở thanh báo: cùng việc, nhưng hai nút trùng tên trên
        // một màn là hai nút không phân biệt được — với người lẫn với Playwright.
        backLabel={editing ? 'Về trang' : 'Trang'}
        onBack={editing ? closeComponent : undefined}
        title={title}
        mono={`/${slug}`}
      >
        {loadingComponent && (
          // `role="status"` để screen reader đọc, và để test có một mốc xác định
          // thay vì đoán bằng thời gian.
          <span role="status" className="flex items-center gap-1.5 text-mini font-medium text-shell-muted">
            <Spinner className="size-3.5" />
            Đang mở component…
          </span>
        )}
        {componentError && (
          <span
            role="alert"
            className="flex max-w-72 min-w-0 items-center gap-1.5 text-mini font-medium text-shell-danger"
            title={componentError}
          >
            <Icon name="alert" size={15} />
            <span className="truncate">{componentError}</span>
          </span>
        )}
        {published && (
          <span
            role="status"
            className={cn(
              'flex max-w-80 min-w-0 items-center gap-1.5 text-mini font-medium',
              published.ok ? 'text-shell-ok' : 'text-shell-danger',
            )}
            title={published.text}
          >
            <Icon name={published.ok ? 'check-circle' : 'alert'} size={15} />
            <span className="truncate">{published.text}</span>
          </span>
        )}

        <PageShare
          pageId={pageId}
          slug={slug}
          siteUrl={siteUrl}
          // Vừa publish xong trong phiên này thì đã có link, dù `baseSeq` chưa kịp nạp lại.
          published={baseSeq !== null || published?.ok === true}
          locale={
            locales.find((l) => l.code === locale) ??
            locales.find((l) => l.isDefault) ??
            locales[0] ?? { code: 'vi', label: 'Tiếng Việt', isDefault: true }
          }
        />

        <a
          href={`/preview/${pageId}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClass('secondary', 'md')}
        >
          <Icon name="eye" size={18} />
          Xem nháp
        </a>

        <Button
          variant="primary"
          size="md"
          icon="upload"
          loading={publishing}
          onClick={() => void publish()}
          // `editing !== null`: đang sửa component thì `savedSeq` bị ép về `null` (xem
          // guard của `lastSeq` phía trên), nên `publishLook` không còn seq nào để so —
          // nó trả `disabled: false` bất kể trang có gì mới hay không. Không chặn ở đây
          // thì bấm "Sửa" trên một trang vừa publish xong sẽ BẬT LẠI nút Publish và xoá
          // luôn con số đang hiện, dù trang chưa hề đổi gì kể từ lần publish đó.
          disabled={pub.disabled || editing !== null}
          /* Nhãn nói rõ PHẠM VI và SỐ LƯỢNG. "Publish" trần là đúng câu đã làm
             người dùng tưởng mình đẩy một trang trong khi đang đẩy cả site; thêm
             con số là để hết cảnh bấm mà không biết đang đẩy bao nhiêu.
             Vẫn chứa chữ "Publish" nên các phép kiểm theo tên nút không đổi. */
          title={
            editing !== null
              ? `Đang sửa component — publish trang bị khoá tới khi thoát chế độ sửa.`
              : pub.disabled
                ? `Bản nháp của /${slug} trùng bản đang chạy — không có gì để đẩy.`
                : `Chỉ publish /${slug}. Các trang khác giữ nguyên bản đang chạy.`
          }
        >
          {publishing ? 'Đang publish…' : pub.text}
        </Button>
      </EditorTopbar>

      {editing && (
        /* Thanh báo phải RÕ và phải chiếm chỗ.
           Không có nó thì canvas trông y hệt lúc sửa trang, và người dùng sẽ sửa
           component tưởng đang sửa trang — rồi thấy chín trang khác đổi theo. */
        <ComponentNotice name={editing.name}>
          <Button variant="secondary" size="sm" icon="arrow-left" onClick={closeComponent} className="ml-auto">
            Quay lại trang
          </Button>
        </ComponentNotice>
      )}

      {/* Bề rộng hai pane co theo màn (xem `--shell-left` trong builder.css):
          240/300 là số chọn cho màn 1440, và trên màn 2560 chúng để cây node
          cắt tên trong khi canvas thừa chỗ. */}
      {/*
        `min-w-0` trên CẢ BA con là bắt buộc, không phải để cho gọn.

        Con của grid mặc định `min-width: auto`, nghĩa là chúng KHÔNG co xuống dưới
        bề rộng min-content của mình. Một tên node dài trong cây, hay một giá trị dài
        trong bảng thuộc tính, sẽ nới cột ra quá phần chỗ có thật và đẩy cả trang tràn
        ngang — đo được 227px ở màn 1440 với một trang 47 node. Track `1fr` không cứu
        được: nó cấp chỗ, nhưng min-content vẫn thắng.
      */}
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 gap-3"
        style={{
          ...rightPane.gridVar,
          gridTemplateColumns: `${
            leftCollapsed ? 'var(--shell-left-rail)' : 'var(--shell-left)'
          } 1fr var(--shell-right)`,
        }}
      >
        <aside className={PANE}>
          <LeftPanel
            doc={active}
            pages={pages}
            presets={presets}
            currentPageId={pageId}
            collapsed={leftCollapsed}
            onToggleCollapse={toggleLeft}
            // Đang sửa component thì không bày đường mở component khác: component
            // lồng component bị chặn ở đường ghi (xem mục 3.2 của HANDOFF).
            onEditComponent={editing ? undefined : editFromPane}
            // Ở chế độ component, chèn preset vào một component khác sẽ tạo
            // instance lồng nhau — thứ bị chặn ở đường ghi. Ẩn tab đi thay vì để
            // người dùng bấm rồi nhận 422.
            componentMode={Boolean(editing)}
          />
        </aside>

        {/* `reloadToken`, KHÔNG phải `key`.
            `key={frameKey}` tháo và dựng lại cả `Canvas` sau MỖI lần doc đổi. Nó
            nạp lại iframe đúng như mong muốn, nhưng kèm theo là mất zoom, mất pan,
            và effect lúc mount chạy lại `focusScreen(breakpoint)` — tức canvas
            nhảy về giữa y như vừa bấm một nút trong cụm thiết bị. Với thao tác lặp
            nhanh như bật/tắt con mắt thì nó nhảy mỗi lần bấm.
            Token đi vào `key` của riêng từng iframe, nên chỉ iframe dựng lại. */}
        <Canvas
          reloadToken={frameKey}
          /*
           * `?locale=` đi vào SRC, không phải một tham số của component.
           *
           * Đổi src là iframe tự nạp lại — không cần `reloadToken`, và cũng không
           * được dùng nó: token đi vào `key` nên nó dựng lại cả iframe, mất luôn vị
           * trí cuộn. Đổi ngôn ngữ mà nhảy về đầu trang là mất đúng thứ người ta
           * đang soi.
           */
          renderSrc={
            editing
              ? `/render/component/${editing.id}`
              : `/render/${pageId}${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`
          }
          // Component cao bằng nội dung; trang cao bằng một màn thiết bị.
          fitContent={Boolean(editing)}
          doc={active}
          presets={presets}
          /* Dải đáy CHIẾM CHỖ trong luồng của canvas, không `fixed`: xem docblock của nó
             cho lý do — cùng bài học mà `PreviewChrome` đã trả giá. `pageId` là `null`
             khi đang sửa component; bảng Văn bản theo từng trang nên lúc đó không có gì
             để trỏ tới. */
          footer={<BottomDock doc={active} pageId={editing ? null : pageId} />}
        />

        {/* `isolate`: `z-30` của tay kéo chỉ có nghĩa BÊN TRONG Inspector. Thiếu nó thì tay
            kéo đè lên popover của canvas tràn sang vùng này (menu quản lý khổ màn) và nuốt click. */}
        <aside className={cn(PANE, 'relative isolate')}>
          <PaneResizer gridRef={gridRef} width={rightPane.width} onCommit={rightPane.commit} />
          <Inspector
            doc={active}
            tokens={tokens}
            components={components}
            pageId={editing ? null : pageId}
            // Chế độ sửa component: không có bản dịch nào để phủ — xem prop.
            locales={editing ? [] : locales}
            translations={editing ? {} : translations}
            seo={editing ? null : seo}
            // Giữ cả ở chế độ sửa component: bảng là của SITE, không theo trang, nên
            // một Form nằm trong component chọn từ đúng bảng đó.
            endpoints={endpoints}
            onEditComponent={editing ? undefined : editFromPane}
          />
        </aside>
      </div>

      {linkNotice && (
        <ToastRegion>
          <Toast tone="warn" title={linkNotice} onClose={() => setLinkNotice(null)} />
        </ToastRegion>
      )}
    </div>
    </AiLinkProvider>
  );
}

/**
 * Khung của pane trái và pane phải: panel nổi trên `shell-bg`, bo góc lớn.
 * `overflow-hidden` để nội dung cuộn bên trong không vẽ đè lên góc bo.
 */
const PANE = cn(ui.panel, 'min-h-0 min-w-0 overflow-hidden');
