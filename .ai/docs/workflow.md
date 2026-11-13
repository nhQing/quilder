<!-- qf-ai:managed — file của plugin qf-toolkit, /init-claude ghi đè khi cập nhật. Luật riêng của dự án: rules.md -->
# Quy trình: nhận việc → sprint → kanban → sub agent

Dùng cho việc nhiều bước hoặc cần chia cho sub agent. Việc vài lệnh là xong thì làm luôn.

## 1. Sprint — lên kế hoạch

1. `qf-ai sprint current`. Chưa có sprint mở → `qf-ai sprint new "<mục tiêu>"`.
2. Ghi việc vào sprint theo cấp **Epic → Task → Subtask** (mẫu sẵn trong file). Với từng task, nghiên cứu trước khi ghi:
   - **Làm gì**: kết quả user nhận được, tiêu chí xong kiểm được.
   - **Làm thế nào**: file nào, hướng tiếp cận, skill nào dùng (`/test`, `/flowmap`, `/fl`, `security-audit`…).
     Tìm file qua `.ai/folder-tree/tree.md`, đọc code thật — đừng đoán đường dẫn.
   - **Model + effort**: theo bảng dưới, kèm một lý do ngắn.
3. Trạng thái task trong sprint: `todo` · `doing` · `blocked` · `done`. Subtask là checkbox.
4. Mọi task `done` → `qf-ai sprint done` (đóng dấu `STATUS: DONE` ở cuối file). Việc mới sau đó vào sprint mới.

| Loại việc | model | effort |
|---|---|---|
| Cơ học, hướng dẫn đã chỉ rõ file + chỗ sửa + nội dung (đổi text, thêm field, rename, test theo mẫu có sẵn) | haiku | low |
| Tính năng nhỏ 1–3 file, sửa bug đã khoanh đúng chỗ, test có logic | sonnet | medium |
| Thiết kế, nhiều module, bug chưa rõ gốc, bảo mật, migration dữ liệu | opus | high |
| Chỉ khi `high` đã thất bại hoặc rủi ro rất cao | opus | xhigh |

**Không viết nổi các bước chính xác cho một task thì task đó không phải của haiku** — nâng tier, hoặc tách nhỏ tiếp.

## 2. Kanban — giao việc cho sub agent

Bảng chỉ sống trong **phiên đang chạy**: phiên kết thúc thì hook tự đóng (chuyển vào trash), `board.html` trống.

1. `qf-ai kanban init --title "<tên việc>"` (tự gắn sprint đang mở).
2. Viết task ra `.ai/trash/tmp/tasks.json` rồi `qf-ai kanban add --file .ai/trash/tmp/tasks.json`:

```json
[{
  "id": "T1", "title": "Thêm field email vào form đăng ký", "epic": "E1 Đăng ký",
  "agent": "coder-haiku-1", "model": "haiku", "effort": "low",
  "files": [{ "path": "src/features/signup/SignupForm.tsx", "what": "thêm input email sau input tên" }],
  "steps": ["Copy khối <Field name=\"name\"> ở dòng ~40, đổi name/label thành email/\"Email\"",
            "Thêm email: z.string().email() vào signupSchema cùng file"],
  "done_when": ["Form có ô Email, nhập sai định dạng thì báo lỗi"],
  "verify": "pnpm test src/features/signup",
  "depends_on": []
}]
```

   Hướng dẫn viết để **model rẻ nhất làm đúng ngay lần đầu**: đường dẫn thật, chỗ sửa cụ thể (hàm, dòng gần đúng, đoạn mẫu
   để bắt chước), bước dạng mệnh lệnh, tiêu chí xong kiểm được, lệnh kiểm tra chạy được. Không viết "tìm xem…", "cân nhắc…".
   Hai task chạy song song không được sửa chung một file.
3. Spawn mỗi task một sub agent: tên = `agent`, `model` và `effort` đúng như task. Prompt chỉ cần:

```text
Bạn là <agent>. Việc của bạn là task <ID> trên bảng kanban của dự án.
1. qf-ai kanban show <ID> — hướng dẫn đầy đủ ở đó. Chỉ sửa các file được liệt kê.
2. qf-ai kanban move <ID> in-progress --by <agent>
3. Code xong: qf-ai kanban move <ID> in-test --by <agent>, chạy lệnh Kiểm tra.
4. Đạt: qf-ai kanban move <ID> ready-review --by <agent> --note "<1 dòng đã làm gì>"
   Không đạt sau 2 lần sửa: giữ in-progress, qf-ai kanban note <ID> "<lỗi + nghi do đâu>" --by <agent>, dừng.
Không đọc board.json, không đụng task khác. Báo lại đúng 1–3 dòng.
```

4. Cột và ai chuyển:

| Cột | Ai chuyển vào |
|---|---|
| `todo` | agent chính lúc tạo task |
| `in-progress` | sub agent khi bắt đầu, hoặc agent chính khi trả task về kèm note |
| `in-test` | sub agent khi code xong, đang chạy kiểm tra |
| `ready-review` | sub agent khi kiểm tra đạt |
| `in-review` | agent chính khi bắt đầu xem diff |
| `done` | agent chính khi diff đúng và kiểm tra đạt |

5. User muốn xem bảng trên điện thoại/máy khác: chạy `qf-ai kanban serve` **ở nền** (lệnh chạy tới khi tắt), đưa user
   địa chỉ `http://<IP LAN>:<cổng>/` nó in ra. Server chỉ đọc, chỉ phục vụ `board.html` và `board.data.js`.
6. Xong hết: cập nhật trạng thái task trong file sprint, `qf-ai kanban close`, tắt server nếu đã bật.

## 3. Bị dừng giữa chừng

User gõ `/handoff` → ghi bàn giao vào `.ai/handoff/`, commit, push. Máy khác: `git pull` rồi `/takeover`.
