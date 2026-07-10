# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Hãy bắt đầu từ những thiết kế tham khảo xuất sắc, không phải từ một khung vẽ AI trống trơn.**

Design Lens là plugin dành cho **Claude Code**, **OpenAI Codex CLI**, **Cursor** và **OpenCode**,
giúp bạn xây dựng những frontend đẹp xuất sắc về mặt thẩm mỹ bằng cách bắt đầu từ các thiết kế
tham khảo (những trang web đẳng cấp awwwards):

1. **Clone** — thu lại một trang tham khảo thành bản sao cục bộ tự chứa, được định dạng dễ đọc:
   DOM cuối cùng đã render bằng JS, giữ nguyên style CSS-in-JS/shadow-DOM, mọi asset được lưu về
   máy, mọi phần tử được đóng dấu bằng một `data-dl-id` ổn định.
2. **Reverse-design** — đọc bản clone như một nhà thiết kế kỳ cựu và tạo ra `DESIGN.md`
   (lý do đằng sau từng quyết định) + `VARIATIONS.md` (những hướng đi mới vẫn giữ nguyên các nguyên tắc).
3. **Customize** — trò chuyện để thay logo, viết lại chữ trên thanh điều hướng, thay ảnh hero,
   đổi màu sắc và kích thước — agent chỉnh sửa trực tiếp bản clone, neo theo `data-dl-id`.

## Cài đặt

| Agent | Kênh khuyến nghị | Chuẩn bị môi trường chạy |
| --- | --- | --- |
| Claude Code | plugin (bên dưới) hoặc `npx skills` | tự động (hook SessionStart) |
| Codex CLI | plugin (bên dưới) hoặc `npx skills` | tin cậy hook qua `/hooks`, hoặc phương án dự phòng bên dưới |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` khi dùng lần đầu |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` khi dùng lần đầu |

### Kênh 1 — plugin (Claude Code / Codex)

Claude Code:

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

Codex CLI:

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

Ở phiên làm việc đầu tiên, một hook `SessionStart` sẽ chuẩn bị `~/.design-lens/` (CLI, Playwright
ghim phiên bản, Chromium). **Trên Codex, bạn phải tin cậy hook của plugin qua `/hooks` trước, hoặc
chạy `bash <plugin-cache-dir>/scripts/bootstrap.sh` một lần bằng tay** — xem
[`plugin/README.md`](./plugin/README.md).

### Kênh 2 — `npx skills` (bất kỳ agent nào hỗ trợ skills)

```bash
npx skills add mojomoth/design-lens          # tự phát hiện các agent đã cài
npx skills add mojomoth/design-lens -a cursor -a opencode   # hoặc nhắm vào các agent cụ thể
```

Các agent cài theo cách này không có hook chuẩn bị môi trường; các skill tự phục hồi bằng cách chạy
`npx -y design-lens setup` khi dùng lần đầu (hoặc bạn tự chạy lệnh này một lần).

### Kênh 3 — CLI thuần qua npm

```bash
npx design-lens setup                        # một lần duy nhất: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # hoặc dùng CLI trực tiếp, không cần plugin nào cả
```

**Dành cho LLM agent** — dán đoạn sau vào agent của bạn:

> Cài đặt design-lens theo hướng dẫn tại https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Vòng lặp dev (không cần cài đặt): `claude --plugin-dir ./plugin`. Một đường dẫn tuyệt đối cục bộ
cũng dùng được thay cho `mojomoth/design-lens` với `marketplace add`.

Các skill (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Tính năng clone dành cho **việc nghiên cứu và phái sinh thiết kế mang tính riêng tư**. Mỗi bản
> clone đều đi kèm một thông báo giấy phép và một danh sách kiểm tra thương hiệu trước khi phát hành:
> thay logo, viết lại nội dung, mua giấy phép hoặc thay thế ảnh và font trước khi phát hành bất cứ
> sản phẩm phái sinh nào. Không bao giờ được triển khai hay phân phối lại bản clone — xem
> [Fair use & tôn trọng nhà thiết kế](./plugin/README.md#fair-use--respect-for-designers).

## Bố cục kho mã

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Phát triển tự trị (harness)

Plugin này được xây dựng một mạch bởi một vòng lặp Ralph — ngữ cảnh agent hoàn toàn mới ở mỗi vòng
lặp, toàn bộ bộ nhớ nằm trên đĩa, một cổng kiểm định lập trình được niêm phong. Để chạy nó:

```bash
./.harness/bootstrap.sh     # một lần duy nhất: git init, Chromium, tự kiểm fixture, niêm phong toàn vẹn
./.harness/ralph.sh plan    # vòng lặp lập kế hoạch: tranh luận 3 nhà phê bình → IMPLEMENTATION_PLAN.md
# điểm kiểm tra khuyến nghị cho con người: đọc lướt .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # vòng lặp build: mỗi vòng một task cho đến khi cổng strict xanh
```

Theo dõi từ một terminal khác:

```bash
./.harness/ralph.sh status                     # task / vòng lặp / chi phí hiện tại
tail -f .harness/logs/current/*.stderr         # đầu ra trực tiếp của agent
cat .harness/status/verify-feedback.md         # những gì cổng kiểm định yêu cầu vòng kế tiếp sửa
touch .harness/STOP                            # dừng nhẹ nhàng; tiếp tục với: ralph.sh resume
```

Ngân sách và model có thể điều chỉnh trong `.harness/config.env`. Vòng lặp chỉ kết thúc khi cả
tuyên bố hoàn thành của agent VÀ cổng niêm phong độc lập (`.harness/verify.sh --strict`) đều pass.

## Giấy phép

MIT. Các phụ thuộc bên thứ ba được đóng gói và phụ thuộc lúc chạy được liệt kê trong
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Nội dung được thu lại bởi `clone` không nằm trong phạm vi
giấy phép đó và vẫn là tài sản của chủ sở hữu.
