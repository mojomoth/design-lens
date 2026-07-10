# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**از طراحی‌های مرجع عالی شروع کنید، نه از یک بوم خالی هوش مصنوعی.**

Design Lens یک plugin برای **Claude Code**، **OpenAI Codex CLI**، **Cursor** و **OpenCode** است
که با شروع از طراحی‌های مرجع (سایت‌هایی در سطح awwwards) به شما کمک می‌کند فرانت‌اندهایی با
زیبایی‌شناسی برجسته بسازید:

1. **Clone** — یک صفحهٔ مرجع را در قالب یک آینهٔ محلی خودکفا و خوش‌قالب‌بندی ثبت کنید:
   DOM نهایی رندرشده با JS، حفظ استایل‌های CSS-in-JS/shadow-DOM، محلی‌سازی همهٔ asset‌ها،
   و مهر یک `data-dl-id` پایدار روی هر عنصر.
2. **Reverse-design** — کلون را مانند یک طراح ارشد بخوانید و `DESIGN.md`
   (چرایی هر تصمیم) + `VARIATIONS.md` (جهت‌های تازه‌ای که اصول را حفظ می‌کنند) تولید کنید.
3. **Customize** — به‌صورت گفت‌وگویی لوگو را عوض کنید، متن ناوبری را بازنویسی کنید، تصویر hero را
   جایگزین کنید، رنگ‌ها و اندازه‌ها را تغییر دهید — agent مستقیماً کلون را ویرایش می‌کند و به
   `data-dl-id` تکیه دارد.

## نصب

| Agent | کانال پیشنهادی | آماده‌سازی محیط اجرا |
| --- | --- | --- |
| Claude Code | plugin (در ادامه) یا `npx skills` | خودکار (هوک SessionStart) |
| Codex CLI | plugin (در ادامه) یا `npx skills` | اعتماد به هوک از طریق `/hooks`، یا راهکار جایگزین در ادامه |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` در نخستین استفاده |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` در نخستین استفاده |

### کانال ۱ — plugin (Claude Code / Codex)

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

در نخستین نشست، یک هوک `SessionStart` مسیر `~/.design-lens/` (CLI، نسخهٔ پین‌شدهٔ Playwright،
Chromium) را آماده می‌کند. **در Codex ابتدا باید از طریق `/hooks` به هوک plugin اعتماد کنید، یا یک
بار به‌صورت دستی `bash <plugin-cache-dir>/scripts/bootstrap.sh` را اجرا کنید** — ببینید
[`plugin/README.md`](./plugin/README.md).

### کانال ۲ — `npx skills` (هر agent دارای قابلیت skills)

```bash
npx skills add mojomoth/design-lens          # agentهای نصب‌شده را خودکار تشخیص می‌دهد
npx skills add mojomoth/design-lens -a cursor -a opencode   # یا agentهای مشخصی را هدف بگیرید
```

agentهایی که به این روش نصب می‌شوند هوک آماده‌سازی ندارند؛ skillها با اجرای
`npx -y design-lens setup` در نخستین استفاده خودشان را ترمیم می‌کنند (یا خودتان یک بار آن را اجرا کنید).

### کانال ۳ — CLI ساده از طریق npm

```bash
npx design-lens setup                        # یک بار برای همیشه: ~/.design-lens، Playwright، Chromium
npx design-lens clone https://example.com    # یا CLI را مستقیم استفاده کنید، بدون هیچ plugin
```

**برای agentهای LLM** — این را در agent خود جای‌گذاری کنید:

> design-lens را با دنبال کردن https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md نصب کن

حلقهٔ توسعه (بدون نصب): `claude --plugin-dir ./plugin`. برای `marketplace add` یک مسیر مطلق محلی
هم به جای `mojomoth/design-lens` کار می‌کند.

Skillها (Claude: `/design-lens:<name>`، Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> قابلیت clone برای **مطالعه و اقتباس خصوصی طراحی** است. هر کلون همراه با یک اعلان مجوز و یک
> چک‌لیست برند پیش از انتشار عرضه می‌شود: پیش از انتشار هر چیز اقتباسی، لوگوها را جایگزین کنید،
> متن‌ها را بازنویسی کنید، برای عکس‌ها و فونت‌ها مجوز بگیرید یا آن‌ها را عوض کنید. کلون‌ها هرگز
> نباید مستقر یا بازتوزیع شوند — ببینید
> [استفادهٔ منصفانه و احترام به طراحان](./plugin/README.md#fair-use--respect-for-designers).

## ساختار مخزن

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## توسعهٔ خودگردان (harness)

این plugin به‌صورت یک‌ضرب توسط یک حلقهٔ Ralph ساخته می‌شود — زمینهٔ agent تازه در هر تکرار،
تمام حافظه روی دیسک، و یک دروازهٔ راستی‌آزمایی برنامه‌ایِ مهر و موم‌شده. برای اجرای آن:

```bash
./.harness/bootstrap.sh     # یک بار برای همیشه: git init، Chromium، خودآزمایی fixture، مهر یکپارچگی
./.harness/ralph.sh plan    # حلقهٔ برنامه‌ریزی: مناظرهٔ ۳ منتقد → IMPLEMENTATION_PLAN.md
# نقطهٔ بازبینی انسانی پیشنهادی: مرور سریع .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # حلقهٔ ساخت: در هر تکرار یک task تا سبز شدن دروازهٔ strict
```

از یک ترمینال دیگر پایش کنید:

```bash
./.harness/ralph.sh status                     # task / تکرار / هزینهٔ فعلی
tail -f .harness/logs/current/*.stderr         # خروجی زندهٔ agent
cat .harness/status/verify-feedback.md         # آنچه دروازه به تکرار بعدی گفت اصلاح کند
touch .harness/STOP                            # توقف نرم؛ ادامه با: ralph.sh resume
```

بودجه‌ها و مدل‌ها در `.harness/config.env` قابل تنظیم‌اند. حلقه تنها زمانی پایان می‌یابد که هم
ادعای تکمیل agent و هم دروازهٔ مهر و موم‌شدهٔ مستقل (`.harness/verify.sh --strict`) هر دو پاس شوند.

## مجوز

MIT. وابستگی‌های شخص ثالثِ باندل‌شده و زمان اجرا در [`plugin/NOTICE.md`](./plugin/NOTICE.md)
فهرست شده‌اند. محتوایی که `clone` ثبت می‌کند مشمول آن مجوز نیست و در مالکیت صاحبانش باقی می‌ماند.
