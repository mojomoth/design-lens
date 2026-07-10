# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Mulailah dari desain referensi yang hebat, bukan dari kanvas AI yang kosong.**

Design Lens adalah plugin untuk **Claude Code**, **OpenAI Codex CLI**, **Cursor**, dan **OpenCode**
yang membantu Anda membangun frontend dengan estetika unggul dengan memulai dari desain referensi
(situs kelas awwwards):

1. **Clone** — menangkap sebuah halaman referensi menjadi mirror lokal yang mandiri dan
   diformat rapi: DOM final hasil render JS, gaya CSS-in-JS/shadow-DOM dipertahankan, setiap aset
   dilokalkan, setiap elemen ditandai dengan `data-dl-id` yang stabil.
2. **Reverse-design** — membaca hasil clone layaknya desainer senior dan menghasilkan `DESIGN.md`
   (alasan di balik setiap keputusan) + `VARIATIONS.md` (arah-arah baru yang tetap menjaga prinsipnya).
3. **Customize** — lewat percakapan, ganti logo, tulis ulang teks nav, ganti gambar hero,
   ubah warna dan ukuran — agent mengedit clone secara langsung, dijangkarkan oleh `data-dl-id`.

## Instalasi

| Agent | Saluran yang disarankan | Penyediaan runtime |
| --- | --- | --- |
| Claude Code | plugin (di bawah) atau `npx skills` | otomatis (hook SessionStart) |
| Codex CLI | plugin (di bawah) atau `npx skills` | percayai hook lewat `/hooks`, atau fallback di bawah |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` saat pertama kali digunakan |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` saat pertama kali digunakan |

### Saluran 1 — plugin (Claude Code / Codex)

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

Pada sesi pertama, sebuah hook `SessionStart` menyiapkan `~/.design-lens/` (CLI, Playwright yang
dipatok versinya, Chromium). **Di Codex Anda harus mempercayai hook plugin lewat `/hooks` terlebih
dahulu, atau menjalankan `bash <plugin-cache-dir>/scripts/bootstrap.sh` sekali secara manual** — lihat
[`plugin/README.md`](./plugin/README.md).

### Saluran 2 — `npx skills` (agent apa pun yang mendukung skills)

```bash
npx skills add mojomoth/design-lens          # otomatis mendeteksi agent yang terpasang
npx skills add mojomoth/design-lens -a cursor -a opencode   # atau targetkan agent tertentu
```

Agent yang dipasang dengan cara ini tidak memiliki hook penyediaan; skill memulihkan dirinya sendiri
dengan menjalankan `npx -y design-lens setup` saat pertama kali digunakan (atau jalankan sendiri sekali).

### Saluran 3 — CLI biasa lewat npm

```bash
npx design-lens setup                        # sekali saja: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # atau gunakan CLI secara langsung, tanpa plugin sama sekali
```

**Untuk agent LLM** — tempelkan ini ke agent Anda:

> Pasang design-lens dengan mengikuti https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Loop dev (tanpa instalasi): `claude --plugin-dir ./plugin`. Path absolut lokal juga dapat dipakai
menggantikan `mojomoth/design-lens` untuk `marketplace add`.

Skill (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Fitur clone ditujukan untuk **studi dan derivasi desain secara privat**. Setiap clone disertai
> pemberitahuan lisensi dan checklist merek pra-rilis: ganti logo, tulis ulang teks, lisensikan atau
> ganti fotografi dan font sebelum merilis apa pun yang bersifat turunan. Clone tidak boleh
> di-deploy atau didistribusikan ulang — lihat
> [Fair use & penghormatan kepada desainer](./plugin/README.md#fair-use--respect-for-designers).

## Tata letak repositori

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Pengembangan otonom (harness)

Plugin ini dibangun sekali jalan oleh sebuah loop Ralph — konteks agent yang segar di setiap
iterasi, seluruh memori tersimpan di disk, dan gerbang verifikasi terprogram yang tersegel. Untuk
menjalankannya:

```bash
./.harness/bootstrap.sh     # sekali saja: git init, Chromium, self-test fixture, segel integritas
./.harness/ralph.sh plan    # loop perencanaan: debat 3 kritikus → IMPLEMENTATION_PLAN.md
# checkpoint manusia yang disarankan: baca sekilas .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # loop build: satu task per iterasi sampai gerbang strict hijau
```

Pantau dari terminal lain:

```bash
./.harness/ralph.sh status                     # task / iterasi / biaya saat ini
tail -f .harness/logs/current/*.stderr         # keluaran agent secara langsung
cat .harness/status/verify-feedback.md         # apa yang diminta gerbang untuk diperbaiki iterasi berikutnya
touch .harness/STOP                            # berhenti secara halus; lanjutkan dengan: ralph.sh resume
```

Anggaran dan model dapat disetel di `.harness/config.env`. Loop hanya berakhir ketika klaim
penyelesaian dari agent DAN gerbang tersegel yang independen (`.harness/verify.sh --strict`)
sama-sama lulus.

## Lisensi

MIT. Dependensi pihak ketiga yang dibundel maupun dependensi runtime dirinci di
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Konten yang ditangkap oleh `clone` tidak tercakup lisensi
tersebut dan tetap menjadi milik pemiliknya.
