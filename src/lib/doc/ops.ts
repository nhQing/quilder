/**
 * Ops engine — mọi thay đổi lên Doc đi qua đây.
 *
 * ## Vì sao op có kiểu chứ không phải JSON Patch
 *
 * JSON Patch sai ba đường với bài toán này:
 *  - path là chuỗi ghép (`/nodes/x/style/md/spacing/pt`) mà model hay sai tinh vi;
 *  - nó không biểu đạt được ý định, nên validator không kiểm được ngữ nghĩa
 *    ("gắn effect tilt" chỉ còn là một phép append vào mảng);
 *  - inverse của `remove` cần giá trị đã xoá, mà op không mang theo.
 *
 * ## Payoff quan trọng nhất
 *
 * **Inspector panel phát ra CÙNG loại op mà AI phát.** Kéo slider padding là
 * dispatch `setStyle`. Nhờ vậy chỉ có một đường mutation, một validator, một
 * history stack, một audit trail — thay vì hai hệ thống phải giữ đồng bộ.
 *
 * ## invert tính TRÊN doc trước khi mutate
 *
 * Đó là điều kiện để undo chính xác: muốn hoàn tác một `removeNode` thì phải
 * giữ lại chính node đã bị xoá, và chỉ doc trước khi mutate mới có nó.
 */

import type {
  ContentOverride,
  Doc,
  EffectAttachment,
  Node,
  NodeId,
  RichText,
  StyleProps,
} from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import type { StyleLayer } from '@/lib/design/breakpoints';

/**
 * Lớp mà `setStyle` ghi vào: `base`, một breakpoint, một state cố định, hoặc một
 * state do effect điều khiển.
 *
 * ## Vì sao state của effect là một OBJECT chứ không phải chuỗi thứ chín
 *
 * `style.states` nhận tên tuỳ ý (xem `ResponsiveStyle.states`). Nếu target là
 * chuỗi tự do thì `'hover'` mang hai nghĩa — lớp cố định `style.hover`, hay khoá
 * `style.states.hover`? — và `applyOne` sẽ phải đoán. Object thì phân nhánh tường
 * minh và không có ca nhập nhằng nào.
 */
export type StyleTarget = 'base' | StyleLayer | { state: string };

export type Op =
  | { op: 'insertNode'; parentId: NodeId; index: number; node: Node }
  | { op: 'removeNode'; nodeId: NodeId }
  | { op: 'moveNode'; nodeId: NodeId; newParentId: NodeId; newIndex: number }
  | { op: 'duplicateNode'; nodeId: NodeId; newId: NodeId }
  | { op: 'setProps'; nodeId: NodeId; props: Record<string, unknown> }
  | { op: 'setStyle'; nodeId: NodeId; target: StyleTarget; patch: Partial<StyleProps> }
  | { op: 'setText'; nodeId: NodeId; field: 'content' | 'label'; value: RichText }
  | { op: 'attachEffect'; nodeId: NodeId; attachment: EffectAttachment }
  | { op: 'updateEffect'; nodeId: NodeId; instanceId: string; params: Record<string, unknown> }
  | { op: 'detachEffect'; nodeId: NodeId; instanceId: string }
  | { op: 'setCustomCss'; nodeId: NodeId; css: string | null }
  | { op: 'setName'; nodeId: NodeId; name: string | null }
  | { op: 'setLocked'; nodeId: NodeId; locked: Node['locked'] | null }
  | { op: 'setPresence'; nodeId: NodeId; render: boolean | null }
  /**
   * Ghi đè nội dung cho MỘT node bên trong một instance.
   *
   * Op riêng chứ không dùng `setProps` với cả bản đồ `overrides`: gửi cả bản đồ
   * nghĩa là hai người sửa hai chữ khác nhau trong cùng instance thì người sau
   * xoá mất thay đổi của người trước. Op này chạm đúng một khoá.
   *
   * `patch: null` gỡ trọn override của node đó, tức là quay về nội dung của
   * component.
   */
  | {
      op: 'setOverride';
      nodeId: NodeId;
      /** Id node LOCAL trong cây component. */
      localId: NodeId;
      patch: ContentOverride | null;
    };

export type OpKind = Op['op'];

export class OpError extends Error {
  constructor(message: string, readonly op?: Op) {
    super(message);
  }
}

/* ── Tiện ích ─────────────────────────────────────────────────────────── */

function clone<T>(value: T): T {
  return structuredClone(value);
}

function node(doc: Doc, id: NodeId): Node {
  const n = doc.nodes[id];
  if (!n) throw new OpError(`node không tồn tại: ${id}`);
  return n;
}

/**
 * Giá trị này là một TAGGED UNION, phải thay hẳn chứ không được trộn.
 *
 * `Len` và `ColorValue` phân biệt nhau bằng key nào có mặt: `{$token}` khác
 * `{v,u}` khác `{clamp}` khác `{hex}`. Trộn hai nhánh của một union cho ra một
 * vật lai không thuộc nhánh nào — và `len()`/`color()` đọc nhánh đầu tiên khớp,
 * nên giá trị người dùng vừa nhập bị bỏ qua trong im lặng.
 *
 * Bug thật đã gặp: ô `gap` đang là `{$token:'space-l'}`, người dùng gõ `16px`,
 * kết quả lưu thành `{$token:'space-l', v:16, u:'px'}` và trang vẫn render
 * `var(--space-l)`. Không lỗi, không cảnh báo, chỉ là thao tác không có tác dụng.
 */
const UNION_KEYS = ['$token', 'v', 'u', 'clamp', 'calc', 'min', 'max', 'hex', 'mix'];

function isTaggedValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => UNION_KEYS.includes(k));
}

/**
 * Cặp đọc/ghi cho lớp mà một `StyleTarget` trỏ tới.
 *
 * Tồn tại để `applyOne` và `invert` không phải cùng biết rằng lớp cố định nằm
 * thẳng trên `style` còn state của effect nằm lồng trong `style.states`. Hai bản
 * của cùng một luật là hai bản sẽ trôi, và ở đây bản trôi nghĩa là undo ghi vào
 * chỗ khác chỗ đã ghi.
 */
function styleLayer(
  target: Node,
  layer: StyleTarget,
): { read: () => Record<string, unknown>; write: (next: Record<string, unknown>) => void } {
  const style = target.style as unknown as Record<string, unknown>;

  if (typeof layer === 'string') {
    return {
      read: () => (style[layer] ?? {}) as Record<string, unknown>,
      write: (next) => {
        // `base` luôn tồn tại — nó là lớp mà mọi lớp khác kế thừa từ đó.
        if (layer !== 'base' && Object.keys(next).length === 0) delete style[layer];
        else style[layer] = next;
      },
    };
  }

  const name = layer.state;
  return {
    read: () =>
      ((style.states as Record<string, unknown> | undefined)?.[name] ?? {}) as Record<
        string,
        unknown
      >,
    write: (next) => {
      const states = (style.states ?? {}) as Record<string, unknown>;
      if (Object.keys(next).length === 0) {
        delete states[name];
        // Bản đồ `states` rỗng thì xoá luôn, cùng lý do như lớp override rỗng:
        // `{ states: {} }` không sinh CSS nào nhưng làm diff và `ownLayer` nói dối.
        if (Object.keys(states).length === 0) delete style.states;
        else style.states = states;
      } else {
        states[name] = next;
        style.states = states;
      }
    },
  };
}

/** Xoá key có giá trị `null` — cách để inspector gỡ một thuộc tính. */
function mergeDeep(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    const prev = out[key];
    const valueIsGroup =
      typeof value === 'object' && !Array.isArray(value) && !isTaggedValue(value);
    const prevIsGroup =
      typeof prev === 'object' && prev !== null && !Array.isArray(prev) && !isTaggedValue(prev);

    if (valueIsGroup && prevIsGroup) {
      // Chỉ trộn sâu vào NHÓM thuộc tính (`spacing`, `layout`…). Gặp một giá trị
      // có kiểu thì thay hẳn — xem UNION_KEYS ở trên.
      out[key] = mergeDeep(prev as Record<string, unknown>, value as Record<string, unknown>);
    } else if (valueIsGroup) {
      // Nhóm CHƯA tồn tại ở lớp này. Vẫn phải chạy qua mergeDeep để `null` bên
      // trong được hiểu là "xoá", không phải một giá trị.
      //
      // Bug thật: gỡ override ở một lớp chưa có nhóm đó gửi
      // `{ spacing: { pt: null } }`; nhánh này trước đây gán thẳng, nên doc lưu
      // `spacing.pt = null`. Sau đó `len(null)` ném lỗi giữa lúc render server
      // component và SẬP CẢ TRANG builder — người dùng chỉ thấy công cụ chết sau
      // khi bấm nút gỡ.
      out[key] = mergeDeep({}, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Mọi id trong cây con, kể cả chính nó. */
export function subtreeIds(doc: Doc, rootId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const n = doc.nodes[id];
    if (!n) continue;
    out.push(id);
    stack.push(...n.children);
  }
  return out;
}

/* ── apply ────────────────────────────────────────────────────────────── */

function applyOne(doc: Doc, op: Op): void {
  switch (op.op) {
    case 'insertNode': {
      const parent = node(doc, op.parentId);
      if (doc.nodes[op.node.id]) throw new OpError(`id đã tồn tại: ${op.node.id}`, op);
      doc.nodes[op.node.id] = { ...op.node, parentId: op.parentId };
      const index = Math.max(0, Math.min(op.index, parent.children.length));
      (parent.children as string[]).splice(index, 0, op.node.id);
      break;
    }

    case 'removeNode': {
      if (op.nodeId === doc.rootId) throw new OpError('không xoá được node gốc', op);
      const target = node(doc, op.nodeId);
      const parent = target.parentId ? doc.nodes[target.parentId] : null;
      if (parent) {
        parent.children = parent.children.filter((c) => c !== op.nodeId) as string[];
      }
      // Xoá cả cây con, nếu không sẽ để lại node mồ côi.
      for (const id of subtreeIds(doc, op.nodeId)) delete doc.nodes[id];
      break;
    }

    case 'moveNode': {
      if (op.nodeId === doc.rootId) throw new OpError('không di chuyển được node gốc', op);
      const target = node(doc, op.nodeId);
      const newParent = node(doc, op.newParentId);
      // Chuyển một node vào trong chính cây con của nó sẽ tạo cycle.
      if (subtreeIds(doc, op.nodeId).includes(op.newParentId)) {
        throw new OpError('không chuyển node vào trong cây con của chính nó', op);
      }
      const oldParent = target.parentId ? doc.nodes[target.parentId] : null;
      if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== op.nodeId);
      target.parentId = op.newParentId;
      const index = Math.max(0, Math.min(op.newIndex, newParent.children.length));
      (newParent.children as string[]).splice(index, 0, op.nodeId);
      break;
    }

    case 'duplicateNode': {
      const target = node(doc, op.nodeId);
      if (doc.nodes[op.newId]) throw new OpError(`id đã tồn tại: ${op.newId}`, op);
      if (!target.parentId) throw new OpError('không nhân bản được node gốc', op);
      const parent = node(doc, target.parentId);
      // Chỉ nhân bản chính node, không nhân cả cây con: nhân cây con cần sinh id
      // mới cho từng hậu duệ, và id đó phải do bên gọi quyết để op còn xác định.
      const copy: Node = { ...clone(target), id: op.newId, children: [] } as Node;
      doc.nodes[op.newId] = copy;
      const at = (parent.children as string[]).indexOf(op.nodeId);
      (parent.children as string[]).splice(at + 1, 0, op.newId);
      break;
    }

    case 'setProps': {
      const target = node(doc, op.nodeId) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.props)) {
        // Những field này có op riêng vì chúng cần kiểm tra bất biến.
        if (['id', 'parentId', 'children', 'type', 'style', 'effects'].includes(key)) {
          throw new OpError(`setProps không được đụng "${key}"`, op);
        }
        if (value === null) delete target[key];
        else target[key] = value;
      }
      break;
    }

    case 'setStyle': {
      const layer = styleLayer(node(doc, op.nodeId), op.target);
      const next = mergeDeep(layer.read(), op.patch as Record<string, unknown>);

      // Gỡ thuộc tính cuối cùng của một nhóm thì xoá luôn nhóm đó.
      //
      // Không làm bước này thì `{ spacing: {} }` ở lại vĩnh viễn: nó không sinh
      // declaration nào nên vô hình trên trang, nhưng `ownLayer` vẫn coi lớp đó
      // là "có nội dung" — inspector thôi báo "chưa có gì riêng ở màn này", và
      // doc phình dần theo mỗi lần người dùng gỡ một override.
      for (const [group, values] of Object.entries(next)) {
        if (
          values && typeof values === 'object' && !Array.isArray(values) &&
          Object.keys(values as Record<string, unknown>).length === 0
        ) {
          delete next[group];
        }
      }

      // Lớp override rỗng thì xoá hẳn, để doc không phình ra vì {} vô nghĩa.
      layer.write(next);
      break;
    }

    case 'setText': {
      const target = node(doc, op.nodeId) as unknown as Record<string, unknown>;
      if (!(op.field in target)) {
        throw new OpError(`node ${op.nodeId} không có trường "${op.field}"`, op);
      }
      target[op.field] = op.value;
      break;
    }

    case 'attachEffect': {
      const target = node(doc, op.nodeId);
      if (target.effects.some((e) => e.id === op.attachment.id)) {
        throw new OpError(`instanceId đã tồn tại: ${op.attachment.id}`, op);
      }
      target.effects = [...target.effects, op.attachment];
      break;
    }

    case 'updateEffect': {
      const target = node(doc, op.nodeId);
      const found = target.effects.find((e) => e.id === op.instanceId);
      if (!found) throw new OpError(`không có effect instance ${op.instanceId}`, op);
      found.params = op.params;
      break;
    }

    case 'detachEffect': {
      const target = node(doc, op.nodeId);
      if (!target.effects.some((e) => e.id === op.instanceId)) {
        throw new OpError(`không có effect instance ${op.instanceId}`, op);
      }
      target.effects = target.effects.filter((e) => e.id !== op.instanceId);
      break;
    }

    case 'setCustomCss': {
      const target = node(doc, op.nodeId);
      if (op.css === null || op.css.trim() === '') delete target.customCss;
      else target.customCss = op.css;
      break;
    }

    case 'setOverride': {
      const target = node(doc, op.nodeId);
      if (target.type !== 'Instance') {
        throw new OpError(`setOverride chỉ dùng được với node Instance, node ${op.nodeId} là ${target.type}`, op);
      }

      if (op.patch === null) {
        delete target.overrides[op.localId];
        break;
      }

      // TRỘN nông vào override đang có: sửa chữ không được xoá mất ảnh đã thay ở
      // cùng node đó. `null` ở một khoá vẫn nghĩa là "xoá khoá này" — trừ
      // `assetId`, nơi `null` là một GIÁ TRỊ thật ("dùng ảnh của component").
      const current = target.overrides[op.localId] ?? {};
      const next = { ...current } as Record<string, unknown>;
      for (const [key, value] of Object.entries(op.patch)) {
        if (value === null && key !== 'assetId') delete next[key];
        else next[key] = value;
      }

      // Override rỗng thì bỏ hẳn khoá, cùng lý do như nhóm style rỗng: nó vô
      // hình trên trang nhưng vẫn làm giao diện báo "node này có ghi đè".
      if (!Object.keys(next).length) delete target.overrides[op.localId];
      else target.overrides[op.localId] = next as ContentOverride;
      break;
    }

    case 'setName': {
      const target = node(doc, op.nodeId);
      if (op.name === null) delete target.name;
      else target.name = op.name;
      break;
    }

    case 'setLocked': {
      const target = node(doc, op.nodeId);
      if (op.locked === null) delete target.locked;
      else target.locked = op.locked;
      break;
    }

    case 'setPresence': {
      const target = node(doc, op.nodeId);
      if (op.render === null) delete target.render;
      else target.render = op.render;
      break;
    }

    default: {
      const never: never = op;
      throw new OpError(`op không rõ: ${JSON.stringify(never)}`);
    }
  }
}

/** Áp một loạt op. Không mutate `doc` đầu vào. */
export function apply(doc: Doc, ops: Op[]): Doc {
  const next = clone(doc);
  for (const op of ops) applyOne(next, op);
  next.schemaVersion = CURRENT_SCHEMA_VERSION;
  return next;
}

/* ── invert ───────────────────────────────────────────────────────────── */

/**
 * Sinh op nghịch đảo, tính TRÊN doc trước khi mutate.
 *
 * Thứ tự trả về đã đảo ngược, nên `apply(apply(doc, ops), invert(doc, ops))`
 * trả về đúng doc ban đầu.
 */
export function invert(doc: Doc, ops: Op[]): Op[] {
  const out: Op[] = [];
  // Cần trạng thái trung gian: op thứ hai có thể phụ thuộc kết quả của op đầu.
  let state = clone(doc);

  for (const op of ops) {
    switch (op.op) {
      case 'insertNode':
        out.push({ op: 'removeNode', nodeId: op.node.id });
        break;

      case 'removeNode': {
        const target = node(state, op.nodeId);
        const parent = target.parentId ? state.nodes[target.parentId] : null;
        const index = parent ? (parent.children as string[]).indexOf(op.nodeId) : 0;
        // Khôi phục cả cây con: xoá đã cuốn theo hậu duệ, nên hoàn tác cũng phải.
        //
        // `subtreeIds` trả về theo thứ tự cha-trước-con, và insertNode CẦN cha
        // tồn tại trước. Nhưng cuối hàm cả mảng bị `.reverse()`, nên ở đây phải
        // đẩy vào theo thứ tự NGƯỢC để sau khi đảo nó ra đúng cha-trước-con.
        const restores: Op[] = [];
        for (const id of subtreeIds(state, op.nodeId)) {
          const n = state.nodes[id]!;
          const parentId = id === op.nodeId ? target.parentId! : n.parentId!;
          const at =
            id === op.nodeId
              ? index
              : (state.nodes[n.parentId!]!.children as string[]).indexOf(id);

          // `children: []` là bắt buộc. insertNode splice id của node vào
          // children của CHA nó; nếu ta khôi phục node kèm nguyên mảng children
          // thì mỗi id con bị thêm hai lần — một lần theo mảng đã khôi phục, một
          // lần theo chính op của nó. Để rỗng rồi các op con tự lấp vào đúng
          // thứ tự index của chúng.
          restores.push({
            op: 'insertNode',
            parentId,
            index: at,
            node: { ...clone(n), children: [] } as Node,
          });
        }
        out.push(...restores.reverse());
        break;
      }

      case 'moveNode': {
        const target = node(state, op.nodeId);
        const oldParent = state.nodes[target.parentId!]!;
        out.push({
          op: 'moveNode',
          nodeId: op.nodeId,
          newParentId: target.parentId!,
          newIndex: (oldParent.children as string[]).indexOf(op.nodeId),
        });
        break;
      }

      case 'duplicateNode':
        out.push({ op: 'removeNode', nodeId: op.newId });
        break;

      case 'setProps': {
        const target = node(state, op.nodeId) as unknown as Record<string, unknown>;
        const before: Record<string, unknown> = {};
        for (const key of Object.keys(op.props)) {
          before[key] = key in target ? clone(target[key]) : null;
        }
        out.push({ op: 'setProps', nodeId: op.nodeId, props: before });
        break;
      }

      case 'setStyle': {
        const current = styleLayer(node(state, op.nodeId), op.target).read();
        // Với mỗi key patch chạm tới, ghi lại giá trị TRƯỚC — hoặc null nếu chưa có.
        const before: Record<string, unknown> = {};
        for (const [group, value] of Object.entries(op.patch as Record<string, unknown>)) {
          const prevGroup = current[group];
          if (prevGroup === undefined) {
            before[group] = null;
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const inner: Record<string, unknown> = {};
            for (const key of Object.keys(value as Record<string, unknown>)) {
              const prev = (prevGroup as Record<string, unknown>)[key];
              inner[key] = prev === undefined ? null : clone(prev);
            }
            before[group] = inner;
          } else {
            before[group] = clone(prevGroup);
          }
        }
        out.push({
          op: 'setStyle',
          nodeId: op.nodeId,
          target: op.target,
          patch: before as Partial<StyleProps>,
        });
        break;
      }

      case 'setText': {
        const target = node(state, op.nodeId) as unknown as Record<string, unknown>;
        out.push({
          op: 'setText',
          nodeId: op.nodeId,
          field: op.field,
          value: clone(target[op.field]) as RichText,
        });
        break;
      }

      case 'attachEffect':
        out.push({ op: 'detachEffect', nodeId: op.nodeId, instanceId: op.attachment.id });
        break;

      case 'updateEffect': {
        const found = node(state, op.nodeId).effects.find((e) => e.id === op.instanceId);
        out.push({
          op: 'updateEffect',
          nodeId: op.nodeId,
          instanceId: op.instanceId,
          params: clone(found?.params ?? {}),
        });
        break;
      }

      case 'detachEffect': {
        const found = node(state, op.nodeId).effects.find((e) => e.id === op.instanceId);
        if (found) out.push({ op: 'attachEffect', nodeId: op.nodeId, attachment: clone(found) });
        break;
      }

      case 'setCustomCss':
        out.push({
          op: 'setCustomCss',
          nodeId: op.nodeId,
          css: node(state, op.nodeId).customCss ?? null,
        });
        break;

      case 'setOverride': {
        const target = node(state, op.nodeId);
        // Nghịch đảo là TRỌN override cũ, không phải patch ngược: trộn nông
        // không đảo được bằng một patch (không biết khoá nào vốn đã vắng mặt).
        const before =
          target.type === 'Instance' ? (clone(target.overrides[op.localId]) ?? null) : null;
        out.push({ op: 'setOverride', nodeId: op.nodeId, localId: op.localId, patch: before });
        break;
      }

      case 'setName':
        out.push({ op: 'setName', nodeId: op.nodeId, name: node(state, op.nodeId).name ?? null });
        break;

      case 'setLocked':
        out.push({
          op: 'setLocked',
          nodeId: op.nodeId,
          locked: clone(node(state, op.nodeId).locked) ?? null,
        });
        break;

      case 'setPresence':
        out.push({
          op: 'setPresence',
          nodeId: op.nodeId,
          render: node(state, op.nodeId).render ?? null,
        });
        break;
    }

    // Tiến state lên để op sau tính nghịch đảo trên đúng bối cảnh của nó.
    state = apply(state, [op]);
  }

  return out.reverse();
}
