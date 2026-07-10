# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Boş bir yapay zeka tuvalinden değil, harika referans tasarımlardan yola çıkın.**

Design Lens; **Claude Code**, **OpenAI Codex CLI**, **Cursor** ve **OpenCode** için, referans
tasarımlardan (awwwards seviyesindeki sitelerden) yola çıkarak estetik açıdan mükemmel
frontend'ler oluşturmanıza yardımcı olan bir eklentidir:

1. **Klonlama** — bir referans sayfayı kendi kendine yeten, düzgün biçimlendirilmiş yerel bir
   yansıya dönüştürür: JS ile render edilmiş nihai DOM, korunmuş CSS-in-JS/shadow-DOM stilleri,
   yerelleştirilmiş tüm varlıklar ve kararlı bir `data-dl-id` ile damgalanmış her öğe.
2. **Tersine tasarım** — klonu kıdemli bir tasarımcı gözüyle okur ve `DESIGN.md`
   (her kararın neden alındığı) + `VARIATIONS.md` (ilkeleri koruyan yeni yönler) üretir.
3. **Özelleştirme** — sohbet ederek logoyu değiştirin, gezinme metnini yeniden yazın, hero
   görselini değiştirin, renkleri ve boyutları ayarlayın — ajan, `data-dl-id` çapasıyla klonu
   doğrudan düzenler.

## Kurulum

| Ajan | Önerilen kanal | Çalışma ortamı hazırlığı |
| --- | --- | --- |
| Claude Code | eklenti (aşağıda) veya `npx skills` | otomatik (SessionStart hook'u) |
| Codex CLI | eklenti (aşağıda) veya `npx skills` | hook'a `/hooks` ile güvenin veya aşağıdaki yedek yöntemi kullanın |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | ilk kullanımda `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | ilk kullanımda `npx -y design-lens setup` |

### Kanal 1 — eklenti (Claude Code / Codex)

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

İlk oturumda bir `SessionStart` hook'u `~/.design-lens/` dizinini hazırlar (CLI, sabitlenmiş
Playwright, Chromium). **Codex'te önce eklenti hook'una `/hooks` ile güvenmeniz veya
`bash <plugin-cache-dir>/scripts/bootstrap.sh` komutunu bir kez elle çalıştırmanız gerekir** —
bkz. [`plugin/README.md`](./plugin/README.md).

### Kanal 2 — `npx skills` (skills destekleyen herhangi bir ajan)

```bash
npx skills add mojomoth/design-lens          # kurulu ajanları otomatik algılar
npx skills add mojomoth/design-lens -a cursor -a opencode   # veya belirli ajanları hedefleyin
```

Bu yolla kurulan ajanlarda hazırlık hook'u yoktur; skill'ler ilk kullanımda
`npx -y design-lens setup` komutunu çalıştırarak kendilerini onarır (veya bunu bir kez kendiniz
çalıştırın).

### Kanal 3 — npm üzerinden düz CLI

```bash
npx design-lens setup                        # tek seferlik: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # veya CLI'yi doğrudan kullanın, eklentiye hiç gerek yok
```

**LLM ajanları için** — bunu ajanınıza yapıştırın:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Geliştirme döngüsü (kurulumsuz): `claude --plugin-dir ./plugin`. `marketplace add` için
`mojomoth/design-lens` yerine yerel bir mutlak yol da kullanılabilir.

Skill'ler (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Klonlama özelliği **özel tasarım incelemesi ve türetme** içindir. Her klon, bir lisans
> bildirimi ve yayına almadan önce uygulanacak bir marka kontrol listesiyle gelir: türetilmiş
> herhangi bir şeyi yayınlamadan önce logoları değiştirin, metinleri yeniden yazın, fotoğrafları
> ve yazı tiplerini lisanslayın veya değiştirin. Klonlar asla dağıtıma alınmamalı veya yeniden
> dağıtılmamalıdır — bkz. [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Depo yapısı

```
plugin/        eklentinin kendisi (otonom olarak inşa edildi — aşağıya bakın)
.agentdocs/    spesifikasyonlar, mimari, kabul kriterleri, ADR'ler, uygulama planı
.harness/      Ralph-loop otonom geliştirme donanımı (mühürlü)
```

## Otonom geliştirme (harness)

Bu eklenti bir Ralph döngüsüyle tek seferde inşa edilir — her iterasyonda taze ajan bağlamı,
tüm bellek diskte, mühürlü programatik bir doğrulama kapısı. Çalıştırmak için:

```bash
./.harness/bootstrap.sh     # tek seferlik: git init, Chromium, fixture öz-testi, bütünlük mührü
./.harness/ralph.sh plan    # planlama döngüsü: 3 eleştirmenli tartışma → IMPLEMENTATION_PLAN.md
# önerilen insan kontrol noktası: .agentdocs/IMPLEMENTATION_PLAN.md dosyasına göz atın
./.harness/ralph.sh build   # inşa döngüsü: katı kapı yeşil olana dek iterasyon başına bir görev
```

Başka bir terminalden izleyin:

```bash
./.harness/ralph.sh status                     # mevcut görev / iterasyon / maliyet
tail -f .harness/logs/current/*.stderr         # canlı ajan çıktısı
cat .harness/status/verify-feedback.md         # kapının bir sonraki iterasyona düzeltmesini söylediği şey
touch .harness/STOP                            # zarif duruş; devam etmek için: ralph.sh resume
```

Bütçeler ve modeller `.harness/config.env` içinde ayarlanabilir. Döngü yalnızca ajanın tamamlama
iddiası VE bağımsız mühürlü kapı (`.harness/verify.sh --strict`) birlikte geçtiğinde sona erer.

## Lisans

MIT. Pakete dahil edilen ve çalışma zamanındaki üçüncü taraf bağımlılıklar
[`plugin/NOTICE.md`](./plugin/NOTICE.md) dosyasında listelenmiştir. `clone` ile yakalanan içerik
bu lisansın kapsamında değildir ve sahiplerinin mülkiyetinde kalır.
