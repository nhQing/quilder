# Sửa site bằng Claude

Quilder có một máy chủ MCP: Claude Desktop (hoặc Claude Code) đọc cấu trúc trang, tìm phần tử theo
lời mô tả, tra design token và **sửa bản nháp** bằng các thao tác có kiểm — không viết code, không
sinh HTML tự do. Suy luận chạy trong gói Claude của bạn, builder không cần API key.

> Đối chiếu lần cuối với **Claude Desktop 6.28899.6** (bản 20/11/2026) trên Windows 11, và với
> trang hỗ trợ [Getting started with local MCP servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
> (23/10/2026) cho phần giao diện. Claude Desktop đổi bố cục Settings khá thường xuyên — chỗ nào
> tên menu khác hướng dẫn, làm theo [Tìm file cấu hình](#3-tìm-đúng-file-cấu-hình) bằng lệnh, cách
> đó không phụ thuộc giao diện.

## Tổng quan

```
Builder (/builder/claude)            Máy chạy Claude Desktop
────────────────────────             ─────────────────────────────────────────────
1. Cấp token          ───────────►   2. Lưu quilder-mcp-server.mjs vào một thư mục
   (kèm cấu hình điền sẵn)           3. Tìm đúng file claude_desktop_config.json
                                     4. Thêm khối cấu hình vào file đó
                                     5. Thoát hẳn Claude rồi mở lại
                                     6. Dấu + trong ô chat → Connectors → thấy công cụ
```

Claude Desktop **tự chạy** `node quilder-mcp-server.mjs` trên máy bạn (MCP qua stdio). File đó gọi
về builder bằng token. Vì vậy:

- Đây **không phải** "connector" của claude.ai. Thêm vào giao diện web claude.ai hay mục
  *Add custom connector* sẽ không bao giờ chạy — connector web cần máy chủ HTTP có URL công khai.
- Máy chạy Claude Desktop phải **gọi tới được builder** (cùng mạng nội bộ / VPN nếu builder ở địa chỉ
  nội bộ như `http://10.60.0.79:3002`).
- Máy đó cần **Node.js 18 trở lên**. Node có sẵn bên trong Claude Desktop chỉ dùng cho *Desktop
  Extensions* (`.mcpb`), không dùng cho server khai trong file cấu hình.

## Chuẩn bị

| Cần | Kiểm |
|---|---|
| Tài khoản builder vai trò **Sửa** (editor) trở lên | Vai trò *Xem* không cấp được token |
| **Claude Desktop** bản mới nhất, đã đăng nhập | Windows: Microsoft Store hoặc [claude.com/download](https://claude.com/download); macOS: tải `.dmg` cùng trang |
| **Node.js 18+** (khuyên dùng bản LTS) | Mở terminal: `node -v` ra `v18…` trở lên |
| Máy gọi được builder | Mở URL builder trong trình duyệt của chính máy đó |

Cài Node.js:

- **Windows:** tải bản LTS ở [nodejs.org](https://nodejs.org), cài mặc định (có tích *Add to PATH*).
  Hoặc trong PowerShell: `winget install OpenJS.NodeJS.LTS`. Cài xong **thoát hẳn Claude Desktop**
  nếu nó đang mở — app chỉ đọc PATH lúc khởi động.
- **macOS:** tải bộ cài `.pkg` LTS ở [nodejs.org](https://nodejs.org) (cài vào `/usr/local/bin/node`),
  hoặc `brew install node`. Dùng nvm/fnm/Volta thì đọc [lưu ý PATH trên macOS](#macos-claude-không-tìm-thấy-node).

Máy công ty có MDM: quản trị có thể đã tắt máy chủ MCP tự thêm (khoá chính sách
`isLocalDevMcpEnabled`) hoặc Developer Mode (`developerModeEnabled`). Khi đó các bước dưới đây không
có tác dụng — nhờ IT mở.

## 1. Cấp token trong builder

1. Đăng nhập builder → **Kết nối Claude** (cuối thanh menu trái).
2. Khung **Cấp token mới**:
   - **Tên thiết bị** — tên máy sẽ dùng token, ví dụ "Laptop Windows của Lan". Để sau này biết thu
     hồi cái nào.
   - **Hạn** — 7, 30 hoặc 90 ngày. Hết hạn thì cấp token mới và thay trong file cấu hình.
   - **Cho phép đăng bản dịch** — để TẮT, trừ khi bạn thật sự muốn Claude tự đưa bản dịch lên site.
3. Bấm **Cấp token**. Khung **Token đã cấp** hiện ra với ba bước đã điền sẵn URL và token.

> Token chỉ hiện **một lần**. Làm xong bước 2–4 dưới đây rồi mới bấm **Tôi đã lưu xong**. Lỡ đóng thì
> thu hồi token đó và cấp cái mới.

Token là mật khẩu: ai có nó sửa được bản nháp site bằng quyền của bạn. Đừng dán vào chat, email,
ticket hay commit vào git.

## 2. Tải file server

Trong khung token, mục **1. Đặt tên kết nối, tải file server**:

- **Tên kết nối trong Claude Desktop** mặc định theo domain builder (vd `quilder-10-60-0-79-3002`) để
  nối nhiều builder không trùng tên. Giữ nguyên là được.
- Bấm **Tải quilder-mcp-server.mjs**, rồi chuyển file vào thư mục riêng của builder đó:

| | Thư mục nên dùng |
|---|---|
| Windows | `C:\Users\<tên-của-bạn>\quilder-mcp\<tên-kết-nối>\quilder-mcp-server.mjs` |
| macOS | `/Users/<tên-của-bạn>/quilder-mcp/<tên-kết-nối>/quilder-mcp-server.mjs` |

Mỗi builder một thư mục: builder ở môi trường khác có thể là phiên bản khác, file server của chúng
không dùng chung được.

Lệnh tạo thư mục và chuyển file từ thư mục Tải về (thay `<tên-kết-nối>`):

```powershell
# Windows — PowerShell
$dir = "$HOME\quilder-mcp\<tên-kết-nối>"
New-Item -ItemType Directory -Force $dir | Out-Null
Move-Item "$HOME\Downloads\quilder-mcp-server.mjs" $dir
```

```bash
# macOS — Terminal
mkdir -p ~/quilder-mcp/<tên-kết-nối>
mv ~/Downloads/quilder-mcp-server.mjs ~/quilder-mcp/<tên-kết-nối>/
```

Kiểm tra đuôi file đúng là `.mjs`: Windows đang ẩn đuôi file thì bật *View → Show → File name
extensions* trong File Explorer; trình duyệt đôi khi lưu thành `quilder-mcp-server.mjs.txt` hoặc
`quilder-mcp-server (1).mjs` — đổi lại cho đúng tên.

## 3. Tìm đúng file cấu hình

Claude Desktop đọc máy chủ MCP từ một file tên `claude_desktop_config.json`. Sai file là lỗi hay gặp
nhất: tạo file ở chỗ khác vẫn "thành công", nhưng Claude không bao giờ đọc nó và **không báo lỗi gì**.

### Windows

| Kiểu cài | File cấu hình |
|---|---|
| **Bản hiện tại** (6.28899.x trở lên, kể cả bản Microsoft Store) | `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude_desktop_config.json` |
| Bản Microsoft Store cũ (trước 11/2026) | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| Bản cài `.exe` cũ | `%APPDATA%\Claude\claude_desktop_config.json` |

Từ 22/11/2026 (bản 6.28899.x) Claude **chuyển** dữ liệu ra `%LOCALAPPDATA%\Claude-Data\`. Thư mục cũ
chỉ còn một file đánh dấu `.user-data-left.…`; sửa file cấu hình ở chỗ cũ không còn tác dụng. Nếu bạn
đã làm theo hướng dẫn cũ, chuyển khối `quilder-…` sang file mới.

Lệnh tìm và mở đúng file (PowerShell) — chọn file theo thứ tự ưu tiên trên, chưa có thì tạo:

```powershell
$cands = @(Get-ChildItem "$env:LOCALAPPDATA\Claude-Data\*\claude_desktop_config.json" -ErrorAction SilentlyContinue | ForEach-Object FullName) + @("$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json", "$env:APPDATA\Claude\claude_desktop_config.json")
$cfg = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cfg) { $d = Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1; $cfg = if ($d) { Join-Path $d.FullName 'claude_desktop_config.json' } else { "$env:APPDATA\Claude\claude_desktop_config.json" }; New-Item -ItemType Directory -Force (Split-Path $cfg) | Out-Null; [IO.File]::WriteAllText($cfg, '{ "mcpServers": {} }') }
$cfg; notepad $cfg
```

### macOS

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Mở bằng Terminal (tạo nếu chưa có):

```bash
mkdir -p ~/Library/Application\ Support/Claude
f=~/Library/Application\ Support/Claude/claude_desktop_config.json
[ -f "$f" ] || echo '{ "mcpServers": {} }' > "$f"
open -e "$f"
```

Hoặc trong Finder: *Go → Go to Folder…* (⇧⌘G) → dán `~/Library/Application Support/Claude`.

### Mở từ trong Claude Desktop

Nếu bản của bạn có nút này, nó luôn mở đúng file: **Settings → Developer → Edit Config** (với bố cục
mới, *Developer* nằm dưới nhóm **This computer**). Mở Settings bằng `Ctrl + ,` (Windows) / `⌘ + ,`
(macOS) hoặc từ menu của app. Không thấy mục *Developer*: **Help → Troubleshooting → Enable Developer
Mode** (nếu bản của bạn có mục đó), hoặc dùng lệnh ở trên.

## 4. Dán cấu hình

**Thoát hẳn Claude Desktop trước khi sửa** (xem bước 5) — bản cũ có lỗi xoá mất máy chủ vừa thêm khi
file bị sửa lúc app đang chạy.

Trong builder bấm **Chép cấu hình** (Windows/macOS chọn ở tab phía trên khối JSON). Khối chép ra có
dạng:

```json
{
  "mcpServers": {
    "quilder-10-60-0-79-3002": {
      "command": "node",
      "args": ["C:/Users/<tên-của-bạn>/quilder-mcp/quilder-10-60-0-79-3002/quilder-mcp-server.mjs"],
      "env": {
        "MM_BUILDER_URL": "http://10.60.0.79:3002",
        "MM_BUILDER_TOKEN": "<token>"
      }
    }
  }
}
```

1. **File đang trống hoặc chỉ có `{ "mcpServers": {} }`** → thay cả file bằng khối trên.
2. **File đã có nội dung** (máy chủ khác, `preferences`, …) → chỉ chép khối `"quilder-…": { … }` vào
   bên trong `mcpServers` sẵn có, thêm dấu phẩy giữa hai khối. **Đừng thay cả file** — mất cấu hình
   cũ.
3. Sửa `<tên-của-bạn>` trong `args` cho đúng chỗ đã lưu file ở bước 2:
   - Windows: dùng dấu `/` như mẫu (`C:/Users/lan/...`). Muốn dùng `\` thì phải viết đôi
     (`C:\\Users\\lan\\...`) — viết một dấu là JSON hỏng.
   - macOS: `/Users/lan/quilder-mcp/...` (đường dẫn tuyệt đối, không dùng `~`).
4. Giữ nguyên `MM_BUILDER_URL`. Thiếu nó, server gọi `http://localhost:3001`.
5. Lưu file (UTF-8 — Notepad của Windows 11 và TextEdit mặc định đã đúng). Kiểm JSON hợp lệ;
   Windows dùng biến `$cfg` từ lệnh ở bước 3, hoặc thay bằng đường dẫn file:

```powershell
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('JSON OK')" "$cfg"
```

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('JSON OK')" ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Ví dụ hai builder trong cùng một file:

```json
{
  "mcpServers": {
    "quilder-10-60-0-79-3002": { "command": "node", "args": ["C:/Users/lan/quilder-mcp/quilder-10-60-0-79-3002/quilder-mcp-server.mjs"], "env": { "MM_BUILDER_URL": "http://10.60.0.79:3002", "MM_BUILDER_TOKEN": "<token dev>" } },
    "quilder-maimoney-com": { "command": "node", "args": ["C:/Users/lan/quilder-mcp/quilder-maimoney-com/quilder-mcp-server.mjs"], "env": { "MM_BUILDER_URL": "https://builder.maimoney.com", "MM_BUILDER_TOKEN": "<token product>" } }
  },
  "preferences": { "…": "giữ nguyên phần sẵn có" }
}
```

## 5. Thoát hẳn rồi mở lại Claude Desktop

Claude chỉ đọc file cấu hình lúc khởi động. Đóng cửa sổ (nút ✕) **không** thoát app.

| | Cách thoát hẳn |
|---|---|
| Windows | Chuột phải biểu tượng Claude ở khay hệ thống (góc phải thanh taskbar, có thể nằm trong `^`) → **Quit**. Hoặc menu ☰ của app → **File → Exit** |
| macOS | `⌘Q` khi Claude đang ở phía trước, hoặc menu **Claude → Quit Claude** |

Kiểm đã thoát hẳn: Windows mở Task Manager không còn tiến trình `Claude`; macOS biểu tượng Dock không
còn chấm. Rồi mở lại Claude Desktop.

## 6. Kiểm tra và dùng thử

1. Trong ô chat bấm **+** (góc dưới) → **Connectors**: thấy `quilder-…` cùng danh sách công cụ, công
   tắc đang bật.
2. Xem trạng thái chi tiết ở **Settings → Developer** (bố cục mới: nhóm **This computer**; một số bản
   đặt ở **Settings → Desktop app → Extensions → Manage → Local MCP servers**): máy chủ ở trạng thái
   đang chạy (*running*), có nút xem log.
3. Gõ thử: *"Liệt kê các trang của site"*. Lần đầu Claude dùng một công cụ, app hỏi quyền — chọn cho
   phép (một lần, cho cả phiên, hoặc luôn luôn, tuỳ bản). Claude gọi `list_pages` và trả danh sách
   trang thật của site.

Từ giờ cứ ra lệnh bằng lời. Claude chỉ sửa **bản nháp**: mở *Xem nháp* trong builder để kiểm, rồi
**Publish** khi ưng.

## Khi không chạy

### Đọc log trước

| | Log |
|---|---|
| Windows (bản hiện tại) | `%LOCALAPPDATA%\Claude\Logs\mcp.log` và `mcp-server-<tên-kết-nối>.log` |
| Windows (bản Store cũ) | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\` |
| macOS | `~/Library/Logs/Claude/mcp.log` và `mcp-server-<tên-kết-nối>.log` |

```powershell
Get-Content "$env:LOCALAPPDATA\Claude\Logs\mcp-server-<tên-kết-nối>.log" -Tail 40
```

```bash
tail -n 40 ~/Library/Logs/Claude/mcp-server-<tên-kết-nối>.log
```

Dòng `Server started and connected successfully` rồi `tools/list` là đã nối được. Gửi log cho người
khác thì **xoá token** trong đó trước.

### Bảng tra lỗi

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Không thấy `quilder-…` trong **+ → Connectors** | Sửa nhầm file; chưa thoát hẳn app; JSON hỏng | Chạy lại lệnh ở [bước 3](#3-tìm-đúng-file-cấu-hình); kiểm JSON; thoát hẳn rồi mở lại |
| Log: `spawn node ENOENT` / *'node' is not recognized* | Claude không tìm thấy Node | Cài Node rồi thoát hẳn Claude; hoặc ghi đường dẫn đầy đủ của node vào `command` (xem dưới) |
| Log: `Cannot find module …quilder-mcp-server.mjs` | Sai đường dẫn trong `args` | Sửa `<tên-của-bạn>`, kiểm tên file và đuôi `.mjs` |
| Log: `THIẾU MM_BUILDER_TOKEN` | Thiếu khối `env` hoặc sai tên biến | Chép lại cấu hình từ builder |
| "Không kết nối được builder" | Builder tắt, sai `MM_BUILDER_URL`, máy không vào được mạng nội bộ/VPN | Mở URL builder trong trình duyệt của chính máy đó |
| "Token hết hạn hoặc đã bị thu hồi" | Hết hạn / ai đó thu hồi | Cấp token mới, thay `MM_BUILDER_TOKEN`, thoát hẳn rồi mở lại |
| "không đủ quyền" | Token đứng tên tài khoản vai trò Xem | Nhờ admin nâng vai trò, cấp token mới |
| Báo file server cũ, cần tải lại | Builder đã nâng cấp hợp đồng công cụ | Tải lại `quilder-mcp-server.mjs` ở **Kết nối Claude**, ghi đè file cũ |
| "Vượt trần tần suất" | Quá 240 lượt đọc / 40 lượt ghi mỗi phút | Chờ theo số giây trong thông báo |
| Chụp ảnh trang báo thiếu Playwright | Máy chưa cài Playwright (chỉ cần cho chụp ảnh và clone) | Trong thư mục chứa file server: `npm i playwright` rồi `npx playwright install chromium` |
| Máy chủ hiện trạng thái *failed* / *disconnected* | Một trong các lỗi trên | Đọc `mcp-server-<tên-kết-nối>.log` |

### Windows: `node` có nhưng Claude không thấy

Cài Node khi Claude đang mở thì app chưa biết PATH mới — thoát hẳn rồi mở lại. Vẫn lỗi thì ghi thẳng
đường dẫn node. Lấy đường dẫn: `(Get-Command node).Source`, rồi:

```json
"command": "C:/Program Files/nodejs/node.exe",
```

### macOS: Claude không tìm thấy `node`

App mở từ Dock/Finder **không** đọc `~/.zshrc`, nên node cài qua nvm, fnm, Volta hay Homebrew trên
Apple Silicon (`/opt/homebrew/bin`) có thể không nằm trên PATH của Claude. Lấy đường dẫn đầy đủ
trong Terminal:

```bash
which node      # vd /opt/homebrew/bin/node hoặc /Users/lan/.nvm/versions/node/v22.12.0/bin/node
```

rồi ghi vào cấu hình:

```json
"command": "/opt/homebrew/bin/node",
```

Dùng nvm thì đổi phiên bản Node sau này phải sửa lại đường dẫn — bộ cài `.pkg` từ nodejs.org
(`/usr/local/bin/node`) tránh được việc đó.

### Chạy thử file server ngoài Claude

Loại trừ lỗi phía Claude: chạy trực tiếp với đúng biến môi trường. Server đứng chờ (không in gì,
không thoát) là ổn; `Ctrl + C` để dừng. Thoát ngay kèm thông báo thì đọc thông báo đó.

```powershell
$env:MM_BUILDER_URL = "http://10.60.0.79:3002"; $env:MM_BUILDER_TOKEN = "<token>"; node "$HOME\quilder-mcp\<tên-kết-nối>\quilder-mcp-server.mjs"
```

```bash
MM_BUILDER_URL="http://10.60.0.79:3002" MM_BUILDER_TOKEN="<token>" node ~/quilder-mcp/<tên-kết-nối>/quilder-mcp-server.mjs
```

Đóng cửa sổ terminal sau khi thử để token không nằm lại trong lịch sử lệnh (PowerShell:
`Clear-History`; zsh: xoá dòng đó trong `~/.zsh_history`).

## Thu hồi, gia hạn, đổi máy

- **Thu hồi:** builder → **Kết nối Claude** → tab **Đang dùng** → **Thu hồi** ở dòng token → xác
  nhận. Có hiệu lực ngay. Admin thu hồi được token của mọi người ở *Tài khoản → Kết nối Claude*.
- **Gia hạn:** token không gia hạn được. Cấp token mới, thay giá trị `MM_BUILDER_TOKEN` trong file
  cấu hình, thoát hẳn rồi mở lại Claude, thu hồi token cũ.
- **Mất máy / đổi máy:** thu hồi token của máy cũ, cấp token mới cho máy mới.
- **Gỡ kết nối:** xoá khối `quilder-…` khỏi `mcpServers`, thoát hẳn rồi mở lại Claude, thu hồi token.

## Dùng với Claude Code (tuỳ chọn)

Claude Code (CLI) dùng cùng file server, thêm bằng lệnh thay vì sửa JSON:

```bash
claude mcp add quilder-10-60-0-79-3002 --scope user \
  -e MM_BUILDER_URL=http://10.60.0.79:3002 \
  -e MM_BUILDER_TOKEN=<token> \
  -- node /Users/<tên-của-bạn>/quilder-mcp/quilder-10-60-0-79-3002/quilder-mcp-server.mjs
```

Trên Windows thay đường dẫn bằng `C:/Users/<tên-của-bạn>/quilder-mcp/...`. Kiểm bằng `claude mcp list`.
Nên cấp token riêng cho Claude Code ("Claude Code – laptop") để thu hồi độc lập với Claude Desktop.

## Claude làm được gì — và không làm được gì

- Sửa chữ, style theo từng breakpoint, gắn effect, chèn/xoá/dời phần tử, sửa component, dịch chữ,
  nhập bài viết trong Kho dữ liệu, clone một trang web thành trang nháp mới.
- **Không publish, không lùi bản, không quản trị.** Công cụ đó không tồn tại với Claude, và máy
  chủ chặn cả ở tầng HTTP. Đưa thay đổi ra site thật luôn là việc của người, sau khi xem nháp.
- Không sửa được phần tử bị **khoá** (nội dung pháp lý), không ghi vào trang đồ gá của test.

## Chỉ đúng phần tử cần sửa

Trong editor, chọn một phần tử rồi bấm **Copy link cho AI** (biểu tượng liên kết ở đầu khung
*Thuộc tính*): được một dòng dạng

```
[Quilder] Trang chủ › Hero › Nút CTA — https://<builder>/builder/<pageId>?node=<nodeId>
```

Dán vào Claude kèm yêu cầu ("đổi nhãn nút này thành …"). Claude mở đúng phần tử đó trước, không
phải đoán, và nói rõ thay đổi chỉ ở trang này hay ở mọi trang dùng chung component.

## Ví dụ

- *"Mở dàn ý trang chủ, rồi chụp ảnh cho tôi xem trên tablet."*
- *"Trên mobile chữ ở chân trang sát mép quá, tăng khoảng cách hai bên."*
- *"Dịch toàn bộ trang Giới thiệu sang tiếng Anh."*
- *"Tạo 5 bài Tin tức nháp từ danh sách này."*
- *"Clone trang https://… thành một trang nháp mới, ảnh để trong thư mục `clone`."*

## Luật riêng của từng site

Gói dự án có thể thêm luật riêng cho Claude (`guideNotes`) — ví dụ "không hứa lợi nhuận" cho site
tài chính. Xem [projects/example/README.md](../../projects/example/README.md).

Chi tiết kỹ thuật và danh sách tool: [mcp/README.md](../../mcp/README.md).

---

[← Mục lục](README.md)
