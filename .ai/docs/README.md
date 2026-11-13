<!-- qf-ai:managed — file của plugin qf-toolkit, /init-claude ghi đè khi cập nhật. Luật riêng của dự án: rules.md -->
# .ai/ — chỗ làm việc của AI trong dự án này

Đọc file này đầu mỗi phiên. Lệnh `qf-ai` là bin của plugin qf-toolkit.

| Thư mục | Để làm gì | Commit? |
|---|---|---|
| `docs/` | `requirements.md` (dự án để làm gì), `rules.md` (luật phải theo), `workflow.md` (quy trình sprint → kanban → sub agent) | có |
| `folder-tree/` | `tree.md`: cây file **tự sinh** sau mỗi lệnh tạo file. `overview.md`: thư mục nào làm gì | `tree.md` không |
| `sprint/` | `sprint-NNN.md`: epic → task → subtask, model + effort từng task. Xong thì cuối file có `STATUS: DONE` | có |
| `kanban/` | `board.json`: task của **phiên đang chạy**, kèm hướng dẫn cho sub agent. Mở `board.html` để xem tiến trình | chỉ `board.html` |
| `flow/` | `flows.json` (luồng, màn hình, nút) → `qf-flowmap` sinh `flows.html`: sơ đồ mọi luồng end-to-end, bấm khối xem mã nguồn. Tạo bằng `/flowmap` | có |
| `handoff/` | Bản bàn giao khi bị dừng giữa chừng (`/handoff`), nhận ở máy khác (`/takeover`) | có |
| `trash/` | Thứ không dùng nữa. Chuyển vào đây thay vì xoá; user dọn khi muốn | không |

## Luật dùng chung

1. **Tìm file**: grep `.ai/folder-tree/tree.md` trước (file lớn thì đừng đọc hết). Chỉ ls/glob khi tree không đủ. Không sửa `tree.md`.
2. **Không xoá file**: `qf-ai trash <đường dẫn> --reason "<vì sao>"`. File tạm (log, ảnh chụp, script thử) ghi thẳng vào `.ai/trash/tmp/`.
3. **Việc nhiều bước hoặc cần sub agent** → theo `workflow.md`. Việc vài lệnh là xong thì làm luôn, không cần sprint.
4. **Luật**: `rules.md` bổ sung cho `CLAUDE.md`. Hai bên mâu thuẫn → theo `CLAUDE.md` và báo user.
5. **Bảng kanban** chỉ ghi qua `qf-ai kanban …`, không sửa tay `board.json` lúc sub agent đang chạy.

## Lệnh

```bash
qf-ai tree                                  # sinh lại cây file (hook đã tự làm)
qf-ai sprint new "<mục tiêu>" | current | done
qf-ai kanban init --title "<>" | add --file <json> | show [<id>] | move <id> <status> [--note "<>"] | close
qf-ai kanban serve                          # xem kanban + flows.html từ thiết bị khác cùng mạng (chỉ đọc)
qf-flowmap [--check]                        # sinh lại .ai/flow/flows.html sau khi sửa code; --check: chỉ báo lệch
qf-ai handoff new <slug> | latest [--remote] | take <file>
qf-ai trash <đường dẫn…> --reason "<>" | trash list | trash empty [--older-than <ngày>] --yes
```
