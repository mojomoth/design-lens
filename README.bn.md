# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md)

**চমৎকার রেফারেন্স ডিজ়াইন থেকে শুরু করুন, ফাঁকা AI ক্যানভাস থেকে নয়।**

Design Lens হলো **Claude Code**, **OpenAI Codex CLI**, **Cursor** ও **OpenCode**-এর জন্য একটি
plugin, যা রেফারেন্স ডিজ়াইন (awwwards-মানের সাইট) থেকে শুরু করে নান্দনিকভাবে অসাধারণ ফ্রন্টএন্ড
তৈরি করতে আপনাকে সাহায্য করে:

1. **Clone** — একটি রেফারেন্স পেজকে স্বয়ংসম্পূর্ণ, সুবিন্যস্তভাবে ফরম্যাট করা লোকাল মিররে ধারণ
   করুন: JS-রেন্ডার করা চূড়ান্ত DOM, CSS-in-JS/shadow-DOM স্টাইল সংরক্ষিত, প্রতিটি অ্যাসেট
   লোকালাইজ় করা, প্রতিটি এলিমেন্টে একটি স্থিতিশীল `data-dl-id` স্ট্যাম্প করা।
2. **Reverse-design** — একজন সিনিয়র ডিজ়াইনারের মতো ক্লোনটি পড়ুন এবং তৈরি করুন `DESIGN.md`
   (প্রতিটি সিদ্ধান্ত কেন নেওয়া হয়েছে) + `VARIATIONS.md` (নীতিগুলো অক্ষুণ্ণ রেখে নতুন দিকনির্দেশনা)।
3. **Customize** — কথোপকথনের মাধ্যমে logo বদলান, nav-এর লেখা নতুন করে লিখুন, hero ছবি
   প্রতিস্থাপন করুন, রং ও আকার পরিবর্তন করুন — agent সরাসরি ক্লোনটি সম্পাদনা করে,
   `data-dl-id` দিয়ে নোঙর করা অবস্থায়।

## ইনস্টল

| Agent | প্রস্তাবিত চ্যানেল | রানটাইম প্রভিশনিং |
| --- | --- | --- |
| Claude Code | plugin (নিচে) বা `npx skills` | স্বয়ংক্রিয় (SessionStart hook) |
| Codex CLI | plugin (নিচে) বা `npx skills` | `/hooks` দিয়ে hook-টিকে বিশ্বাস করুন, অথবা নিচের বিকল্প পথ |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | প্রথম ব্যবহারে `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | প্রথম ব্যবহারে `npx -y design-lens setup` |

### চ্যানেল ১ — plugin (Claude Code / Codex)

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

প্রথম সেশনে একটি `SessionStart` hook `~/.design-lens/` (CLI, পিন করা Playwright, Chromium)
প্রস্তুত করে। **Codex-এ আগে `/hooks` দিয়ে plugin hook-টিকে বিশ্বাস করতে হবে, নয়তো একবার হাতে
`bash <plugin-cache-dir>/scripts/bootstrap.sh` চালাতে হবে** — দেখুন
[`plugin/README.md`](./plugin/README.md)।

### চ্যানেল ২ — `npx skills` (skills-সক্ষম যেকোনো agent)

```bash
npx skills add mojomoth/design-lens          # ইনস্টল করা agent স্বয়ংক্রিয়ভাবে শনাক্ত করে
npx skills add mojomoth/design-lens -a cursor -a opencode   # অথবা নির্দিষ্ট agent লক্ষ্য করুন
```

এভাবে ইনস্টল করা agent-গুলোর কোনো প্রভিশনিং hook থাকে না; skill-গুলো প্রথম ব্যবহারে
`npx -y design-lens setup` চালিয়ে নিজেরাই নিজেদের সারিয়ে নেয় (অথবা একবার নিজেই চালিয়ে নিন)।

### চ্যানেল ৩ — npm-এর মাধ্যমে সাধারণ CLI

```bash
npx design-lens setup                        # একবারই: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # অথবা কোনো plugin ছাড়াই CLI সরাসরি ব্যবহার করুন
```

**LLM agent-দের জন্য** — এটি আপনার agent-এ পেস্ট করুন:

> https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md অনুসরণ করে design-lens ইনস্টল করো

Dev লুপ (ইনস্টল ছাড়া): `claude --plugin-dir ./plugin`। `marketplace add`-এর ক্ষেত্রে
`mojomoth/design-lens`-এর জায়গায় একটি লোকাল অ্যাবসোলিউট পাথও চলে।

Skills (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`।

> Clone ফিচারটি **ব্যক্তিগত ডিজ়াইন অধ্যয়ন ও ডেরিভেশনের** জন্য। প্রতিটি ক্লোনের সঙ্গে একটি
> লাইসেন্স নোটিশ ও শিপ-পূর্ব ব্র্যান্ড চেকলিস্ট থাকে: ডেরাইভ করা কিছু শিপ করার আগে logo
> প্রতিস্থাপন করুন, কপি নতুন করে লিখুন, ফটোগ্রাফি ও ফন্টের লাইসেন্স নিন বা সেগুলো বদলে দিন।
> ক্লোন কখনোই ডিপ্লয় বা পুনর্বিতরণ করা যাবে না — দেখুন
> [Fair use ও ডিজ়াইনারদের প্রতি সম্মান](./plugin/README.md#fair-use--respect-for-designers)।

## রিপোজ়িটরির বিন্যাস

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## স্বায়ত্তশাসিত ডেভেলপমেন্ট (harness)

এই plugin-টি একটি Ralph লুপ দিয়ে এক দফায় তৈরি — প্রতিটি ইটারেশনে নতুন agent কনটেক্সট, সব
মেমরি ডিস্কে, আর একটি সিল করা প্রোগ্রাম্যাটিক ভেরিফিকেশন গেট। এটি চালাতে:

```bash
./.harness/bootstrap.sh     # একবারই: git init, Chromium, fixture self-test, integrity seal
./.harness/ralph.sh plan    # পরিকল্পনা লুপ: ৩-সমালোচকের বিতর্ক → IMPLEMENTATION_PLAN.md
# প্রস্তাবিত মানব চেকপয়েন্ট: .agentdocs/IMPLEMENTATION_PLAN.md একনজরে দেখে নিন
./.harness/ralph.sh build   # বিল্ড লুপ: strict গেট সবুজ না হওয়া পর্যন্ত প্রতি ইটারেশনে একটি task
```

অন্য টার্মিনাল থেকে নজর রাখুন:

```bash
./.harness/ralph.sh status                     # বর্তমান task / ইটারেশন / খরচ
tail -f .harness/logs/current/*.stderr         # লাইভ agent আউটপুট
cat .harness/status/verify-feedback.md         # গেট পরবর্তী ইটারেশনকে কী ঠিক করতে বলেছে
touch .harness/STOP                            # মসৃণভাবে থামুন; আবার শুরু: ralph.sh resume
```

বাজেট ও মডেল `.harness/config.env`-এ সমন্বয়যোগ্য। agent-এর সমাপ্তির দাবি এবং স্বাধীন সিল করা
গেট (`.harness/verify.sh --strict`) — দুটোই পাস করলে তবেই লুপ শেষ হয়।

## লাইসেন্স

MIT। বান্ডল করা ও রানটাইম থার্ড-পার্টি ডিপেনডেন্সিগুলো [`plugin/NOTICE.md`](./plugin/NOTICE.md)-এ
তালিকাভুক্ত। `clone` দিয়ে ধারণ করা কনটেন্ট ওই লাইসেন্সের আওতায় পড়ে না এবং তা মালিকদের
সম্পত্তি হিসেবেই থেকে যায়।
