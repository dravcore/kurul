# Tasarım

Kurul web uygulamasının görsel ve etkileşim dili: ilkeler, token'lar, yerleşim, hareket,
durumlar ve metin.

> 🌐 [English (canonical)](../design.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [1. Tasarım ilkeleri](#1-tasarım-ilkeleri)
- [2. Kimlik](#2-kimlik)
- [3. Tasarım token'ları](#3-tasarım-tokenları)
- [4. Yerleşim ve yoğunluk](#4-yerleşim-ve-yoğunluk)
- [5. Etkileşim kalıpları](#5-etkileşim-kalıpları)
- [6. Durumlar](#6-durumlar)
- [7. UI metni](#7-ui-metni)
- [8. Grafikler ve dashboard](#8-grafikler-ve-dashboard)
- [9. Erişilebilirlik](#9-erişilebilirlik)
- [10. Çapraz referanslar](#10-çapraz-referanslar)

> **Durum.** Aşağıdaki renk, tipografi ve spacing token'ları üründe **doğrulanmıştır**
> (`apps/web/app/globals.css`). Hâlâ aspirasyonel olan etkileşim kalıpları satır içinde
> belirtilir; her cümleyi shipped davranış sanmayın.

## 1. Tasarım ilkeleri

1. **Nefes alanıyla yoğunluk.** Bir board bir çalışma yüzeyidir. Satırlar kompakttır ve hava
   grupların _arasına_ gider, asla içine değil — 36px satırlar, 300px column'lar, bir laptop'ta
   dört kart. Trello kadar havadar değil, Jira kadar sıkışık değil.
2. **Klavye öncelikli, pointer'la eşit.** Her etkileşimin bir klavye yolu vardır, drag and drop
   dahil. Focus her zaman görünürdür ve ait olmadığı bir yerde asla hapsolmaz.
3. **Tek bir signature, sakin bir çevre.** Kimliği (§2) tam olarak tek bir eleman taşır; geri
   kalan her şey disiplinli nötrlerdir. Birinin işi bulmasına, taşımasına veya iş hakkında karar
   vermesine yardımcı olmayan her şey kesilir.
4. **Her iki tema da birinci sınıftır.** Koyu tema _seçilir_, türetilmez. Her renk bir
   token'dan geçer; bir component'teki ham bir hex bir kusurdur
   ([coding-standards.md](coding-standards.md#stil)).
5. **Durumlar bir ruh hali değil, bir yöndür.** Boş ekranlar bir aksiyona davet eder, hatalar ne
   olduğunu ve sırada ne yapılması gerektiğini söyler, yükleme ekranı yüklenmekte olan şeye
   benzer.
6. **String'ler bir tasarım malzemesidir.** Metin, spacing gibi tasarlanır, ekranın kullanıcı
   tarafından yazılır ve ilk günden itibaren i18n katmanı üzerinden sunulur (§7).

## 2. Kimlik

Kurul, adını toplanıp karar alan ve işi bölüşen heyetten alır — ve v0.2.0'a kadar projeye ilk
adını veren _kurultay_'dan: boylar toplanır, sancaklar dikilir, meseleler karara bağlanır, iş
bölüştürülür. Kimlik hâlâ _bu_ dünyadan gelir — sancak, damga, bozkır — jenerik
prodüktivite-aracı dilinden değil. Ad kısaldı, görsel dil değişmedi.

**Signature eleman — sancak rail'i:** o an aktif olan neyse onun leading edge'inde 2px'lik bakır
renginde bir çizgi (aktif sidebar öğesi, focus'taki column, seçili kart, açık panelin leading
edge'i, bir drag sırasındaki insertion point). App chrome'da signature rengin tam yoğunlukta
göründüğü tek yerdir ve _hareket eder_ — yanıp sönmek yerine pozisyonlar arasında kayarak geçer.
Renkli bir header veya tonlanmış bir background yerine bu seçildi çünkü layout'a hiçbir maliyeti
yok, 36px satır yüksekliğinde hayatta kalıyor, yoğun bir column'da anında okunuyor — ve kelimenin
tam anlamıyla meclisin toplandığı yere dikilen sancaktır. Board'da seçili task kart bir istisna:
rail'i kartlar arasında kayan değil, kartın kendi sol edge'ine sabit; sidebar'daki hareketli rail
değişmedi.

Bakır iki güç seviyesinde çalışır ve bu fazın bulup düzelttiği kusur tam olarak bu ikisinin
birbirine karışmasıydı.

**Tam güç** (`--primary` ile `--signature` her temada aynı hex'i paylaşır) uygulamanın en nadir
rengidir: **ekran başına en fazla iki kullanım**, sancak rail'i, artı, varsa o view'ın tek
primary action button'ı. Bu sayıma üçüncü bir kullanım olarak girmeyen, muaf tutulan iki şey
vardır. **Focus ring** de tam güçtedir, ama yapısı gereği tekildir ve geçicidir: tek seferde tek
bir elemanda, yalnızca o eleman focus'u tuttuğu sürece, bu yüzden rail'in yanında ikinci bir
işaret olarak durmaz, o elemanın zaten taşıdığı işaretin yerine geçer. Ve bir **data işareti**
(bir meter fill'i, bir progress fill'i, grafiğin tek `--signature` **emphasis** serisi, §8) tam
güçte çizilir çünkü o, ekranın etrafındaki chrome'u değil, gösterilen değerin kendisidir; bu
yüzden bir settings sayfası, kendi tek copper Invite button'ının yanında bir copper progress
bar'ı, üçüncü bir chrome kullanımı harcamadan taşıyabilir.

**Tint** (`--signature-subtle`) hiçbir zaman tam güce ulaşmaz ve bu bütçeye de girmez, ama
bedava bir dekorasyon değildir: tam olarak tek bir role bağlıdır, **aktif veya seçili**, o anda
o durumda olan satır, kart, drop-target column veya panel her neyse onun üzerinde. Bir ekran
aynı anda birden fazla elemanı bu şekilde tint'leyebilir, bir multi-select'teki her seçili satır
gibi, iki kullanımlık bütçeyi harcamadan, çünkü tint kimliği değil durumu işaretler.

| Signature bakır nerede görünebilir                                                                                 | Nerede görünmemeli                                             |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Sancak rail'i (aktif / seçili / drop target)                                                                       | Sayfa veya section background'ları, header'lar, hero wash'ları |
| View'ın tek primary action button'ı                                                                                | Secondary ve tertiary button'lar                               |
| Focus ring, yukarıdaki gibi muaf · meter, progress fill'leri ve grafiğin emphasis serisi, data işareti olarak muaf | Kart border'ları, divider'lar, tablo header'ları               |
| Body metni içindeki link'ler                                                                                       | Label'lar, priority badge'leri, status badge'leri, avatar'lar  |
| Wordmark ve empty-state mark'ları                                                                                  | Grafikler, tek **emphasis** serisi dışında                     |

Her iki güç seviyesinde de iki kural geçerlidir. **Tonlanmış bir zemin üstünde renkli metin
olmaz**: tint'lenmiş bir satır veya drop-target column, anlamını bir dot veya bir ikonda taşır,
asla tint'in üstüne yatırılmış renkli bir label'da değil (§8, grafik legend'ları için aynı
kuralı yazar: "metin text token giyer, asla series hue'sunu değil"). Ve **bakır metin
`--accent` üzerine hiç konmaz**: açık temada orada 4.28:1 ölçülür (§3), tek başına AA'yı
geçecek bir sayı, ama kural bir taban değil bir yasak olarak yazılıdır, çünkü `--accent`
chrome'un kendi hover adımıdır ve üstündeki bakır bir link gibi değil, kimliğin mobilyaya
sızması gibi okunur.

Aynı anda iki tam güç işaret görünüyorsa ve bunlar rail ile o view'ın tek primary action'ı
değilse, biri yanlıştır.

| İkonografi                                              | Kural                                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark, empty state'ler, auth ve marketing görselleri | **Damga esinli mark'lar** — 24px grid üzerinde geometrik, tek stroke'lu tamga formları, 1.5px stroke, surface başına bir tane, maksimum 96px. El yapımı SVG; asla bir ürün ikonu değil. |
| Tüm ürün arayüzü                                        | **lucide** (shadcn/ui ile birlikte gelir) — dense satırlarda 16px, sidebar'da 20px, 1.5px stroke, yalnızca `currentColor`                                                               |

**Anti-brief.** Bilinçli olarak _şu değil_: serif bir font ve kiremit rengi bir accent'le sıcak
krem bir ground; asit bir accent'le neredeyse siyah; sıfır radius'ta broadsheet hairline'ları.
Kurul'un nötrleri bilinçli olarak soğuk yeşil-gri akar — tam olarak sıcak bakırın karşısına
oturacağı bir şey olsun diye; sıcak bir ground üzerinde sıcak bir accent hem şu anki varsayılan
görünüm hem de accent'i kaybettirmenin bir yolu.

## 3. Tasarım token'ları

Faz 3 için öneriler, `components/ui/`'ın değiştirilmemiş generated output olarak kalması için
shadcn/ui CSS-variable konvansiyonuna göre adlandırıldı. **Dikkat:** shadcn'in kendi
vokabülerinde `--primary` marka action rengidir ve `--accent` ise subtle hover surface'idir; bu
yüzden Kurul'un signature bakırı `--primary`'dir ve `--accent` sakin bir nötr tint olarak
kalır. shadcn'in variable'larını yeniden adlandırma.

### Nötrler ve accent

Düşük kroma bir yeşil-gri ("felt") ramp'i. Açık temanın canvas'ı bir gri adımıdır ve kartlar
beyazdır, bu yüzden elevation shadow olmadan okunur.

| Rol                                                                    | Token                           | Açık                   | Koyu                  |
| ---------------------------------------------------------------------- | ------------------------------- | ---------------------- | --------------------- |
| Canvas                                                                 | `--background`                  | `#F7F8F7`              | `#131715`             |
| Column ground'u                                                        | `--muted`                       | `#F1F3F1`              | `#1A1E1C`             |
| Kart surface'i                                                         | `--card`                        | `#FFFFFF`              | `#212523`             |
| Popover surface'i                                                      | `--popover`                     | `#FFFFFF`              | `#272B29`             |
| Hover adımı (drag preview kart surface'inde kalır, `--elevation-drag`) | `--accent`, `--secondary`       | `#EAEDEA`              | `#2F3331`             |
| Border · border-strong (`--input`, `--border-strong`'u okur)           | `--border` · `--border-strong`  | `#D6DAD8` · `#7D8481`  | `#3A403D` · `#767D7A` |
| Metin, primary                                                         | `--foreground`                  | `#191C1B`              | `#E8ECEA`             |
| Metin, secondary                                                       | `--foreground-secondary`        | `#545A57`              | `#BCC3BF`             |
| Metin, muted                                                           | `--muted-foreground`            | `#626965`              | `#98A09C`             |
| Primary action surface'i · hover                                       | `--primary` · `--primary-hover` | `#A85A28` · `#964F23`  | `#D98A4E` · `#E0955B` |
| Primary üzerinde metin                                                 | `--primary-foreground`          | `#FFFFFF`              | `#131715`             |
| Rail, focus ring, link                                                 | `--signature`, `--ring`         | `#A85A28`              | `#D98A4E`             |
| Signature tint (seçili satır, drop zone)                               | `--signature-subtle`            | `#F2E6DA`              | `#37291D`             |
| Destructive action hover'ı                                             | `--destructive-hover`           | `#B0241C`              | `#B8524A`             |
| Dialog ve drawer backdrop'u                                            | `--overlay-scrim`               | `rgb(25 28 27 / 0.38)` | `rgb(5 7 6 / 0.7)`    |

Metin token'larının en kötü ölçüldüğü surface (`app/globals.contrast.test.ts`): açık `--foreground`
14.0:1, `--foreground-secondary` 5.8:1 ve `--muted-foreground` 4.6:1, hepsi `--signature-subtle`
üzerinde en kötü; koyu `--foreground` 10.8:1, `--foreground-secondary` 7.1:1 ve
`--muted-foreground` 4.8:1, hepsi `--accent` üzerinde en kötü. Bakır, running text olarak iki
surface dışında hepsini geçer, ikisi de açık temada, ikisi de tabanın kaydırılması değil kayıtlı
bir istisna: hover adımında 4.28:1, orada hiçbir call site bakır metin çizmiyor, ve signature
tint'te 4.11:1, bu açıkça yasak (aşağıda); koyu temada altısını da geçer, `--accent` üzerinde en
kötü 4.70:1. Bir fill olarak, `--primary` üzerindeki `--primary-foreground` açık temada beyazı
5.05:1'de, koyu temada ink'i 6.63:1'de taşıyor; koyu temada bu sayı, canvas üzerinde okunanla
aynı, çünkü `--primary-foreground` ile `--background` orada aynı hex'i paylaşıyor.

`--signature-subtle` hiçbir zaman bakır (`--primary`, `--signature`) metin taşımaz: yukarıdaki
istisna bir kuraldır, bir tasarım izni değil, ve `app/globals.contrast.test.ts` bunu böyle tutmak
için her run'da tüm call site'ları yeniden tarar. Nötr `--foreground` metni izinlidir ve diğer her
surface gibi ona karşı ölçülür, açık temada 14.0:1, koyu temada 11.8:1.

### Semantik skalalar — status ve priority

Rezerve edilmiş tek bir severity ailesi ikisine de hizmet eder, her zaman bir **ikon ve bir
kelimeyle** birlikte shiplenir, asla yalnızca renkle değil. priority, label'lardan ayrı tutulan
sıralı bir skalerdir; sırası artan kroma ile taşınır, böylece renk körlüğünden, grayscale
baskıdan ve sesli tarif edilmekten sağ çıkar.

| Anlam                            | priority | Token                                 | Açık      | Koyu      | `--card` üzerinde kontrast, A / K | İkon           |
| -------------------------------- | -------- | ------------------------------------- | --------- | --------- | --------------------------------- | -------------- |
| Nötr / inaktif                   | `LOW`    | `--priority-low`                      | `#6B726E` | `#8A928E` | 4.9 / 4.9                         | `chevron-down` |
| Bilgi                            | `MEDIUM` | `--status-info`, `--priority-medium`  | `#3F6B99` | `#6BA3E8` | 5.6 / 5.9                         | `minus`        |
| İyi / tamamlandı                 | -        | `--status-good`                       | `#1D7349` | `#3FBF85` | 5.8 / 6.7                         | `check`        |
| Uyarı / süresi yaklaşıyor        | `HIGH`   | `--status-warning`, `--priority-high` | `#8A5A00` | `#D9A227` | 5.9 / 6.8                         | `chevron-up`   |
| Tehlike / gecikmiş / destructive | `URGENT` | `--status-danger`, `--destructive`    | `#C0281F` | `#F47A73` | 5.9 / 5.8                         | `chevrons-up`  |

priority, full-kroma bir ikon artı metin olarak render edilir; label'lar ise renkli bir nokta ile
tonlanmış bir chip olarak render edilir — farklı ağırlıklar, böylece kırmızı bir priority ile
kırmızı bir label asla aynı okunmaz. `Label.color` bir hex değil, bir **slot adı** (`slot-1`…
`slot-8`) saklar, böylece bir label'ın chip'i ile bir grafikteki bar'ı, temaya göre resolve
edilen tek bir identity olur (§8).

### Tipografi — öneri

Open-source, self-hostable, komple Latin Extended-A: Turkish (`ı İ ğ ş ç ö ü`) doğru render
edilmelidir çünkü ilk çeviri paketi budur — bu gereksinim, moda display font'larının çoğunu
elemiştir. Üçü de build time'da `next/font/google` ile self-hosted'dır (Next font dosyalarını
indirir ve gömer — binary font asset'lerini repoya commit etmeden `next/font/local` ile
eşdeğer). Üç fontun `next/font` `.variable` sınıfları `<body>`'de değil `<html>`'dedir: bu
değişkenlere referans veren token stack'leri (`app/globals.css`'teki `--font-sans`,
`--font-display`, `--font-mono`) `var()` çağrılarını `:root` üzerinde çözer, bir custom property
da yalnızca kendisini tanımlayan öğeye karşı çözülür, dolayısıyla `<body>`'ye konan bir değişken
doğrudan fallback fontlara düşer.

| Rol       | Font                                                         | Nerede                                                                      | Neden bu                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display   | **Fraunces** (variable, OFL), `WONK 0 SOFT 0`, yüksek `opsz` | Wordmark, auth, marketing, empty-state headline'ları. Board'un içinde asla. | Kaligrafik değil, high-contrast ve oyulmuş gibi — bir mühüre kazınmış bir şey gibi okunuyor, ki bu tam olarak _damga_ register'ı. Axis'leri quirk'i sıfıra çekip yalnızca gravürü tutmamızı sağlıyor.                                             |
| Body / UI | **Archivo** (variable, OFL)                                  | Üründeki her şey                                                            | Bir signage grotesque: yüksek x-height, ekonomik genişlikler, 12–13px'te okunaklı. Bir board, dar column'larda yüzlerce kısa string demek — bir signage problemi. Doğru olan ama framework varsayılanı gibi okunan Inter ve Geist yerine seçildi. |
| Mono      | **JetBrains Mono** (OFL), `0.92em`                           | Id'ler, shortcut'lar, kod                                                   | Belirsiz olmayan `0/O` ve `1/l/I` — bir stil tercihi değil, bir UUIDv7 okunabilirlik aracı                                                                                                                                                        |

| Adım                   | Boyut / satır     | Weight    | Kullanım                                                             |
| ---------------------- | ----------------- | --------- | -------------------------------------------------------------------- |
| `display`              | 40 / 44           | 600       | Auth veya marketing ekranı başına bir tane                           |
| `title-lg` · `title`   | 20 / 28 · 16 / 24 | 600       | Sayfa ve panel başlıkları · section ve dialog başlıkları             |
| `read`                 | 14 / 21           | 400       | Uzun prose: task description, comment body, import report cümleleri  |
| `body` · `body-strong` | 13 / 18           | 400 · 550 | **UI baseline** — field'lar ve satırlar · kart başlıkları, aktif nav |
| `small` · `micro`      | 12 / 16 · 11 / 14 | 400 · 500 | Metadata, timestamp'ler · chip'ler, count'lar, axis tick'leri        |

Bu ölçeğin tamamı budur, bir Tailwind varsayılanının fark edilmeden dolduracağı bir boşluk
bırakmaz: `text-sm`, `text-lg`, `text-xs` ve `font-medium` component ağacından tamamen kalktı,
ve `app/theme-classes.test.ts` ağaçtaki her `text-`, `bg-`, `border-`, `font-` ve `shadow-`
class'ını Tailwind üzerinden derleyip hiçbir şey üretmeyen birini build'i kırarak yakalıyor;
böylece geri dönen bir varsayılan bir daha fark edilmeden yerleşemiyor. `text-lg`, her çağrı
yerinde `title` (16/24) oluyor, `DialogTitle` dahil: bir dialog'un başlığı bir section
başlığıdır, kendine ait bir boyut değil, ve zaten `18px`'lik bir adım hiç olmadı. `text-xs`,
`small` (12/16) oluyor, asla `micro` (11/14) değil: iki çağrı yeri de bir button label'ı ve bir
keyboard-shortcut ipucuydu, ikisi de en küçük adıma sığacak kadar metadata değil. `font-medium`
her yerde `font-strong` (550) oluyor. Label ve dialog başlığı artık kendi adımlarının
line-height'ını taşıyor, 18px ve 24px, üstüne binmiş bir `leading-none` olmadan: o, davetsiz
misafir bir shadcn varsayılanıydı, bu ölçeğin hiç istediği bir seçim değildi. (Tailwind'in kendi
`text-base`'i, 16px, 768px altındaki üç form field'inde bilinçli bir istisna olarak kalıyor,
§4, bu ölçekte bir boşluk değil.)

`read` (14/21, weight 400) bilinçli olarak kapalı bir listedir, genel bir prose boyutu değil:
task description, comment body ve import report cümleleri onu taşır, başka hiçbir yerde. Kart'lar,
bir description snippet'i gösterseler bile `body` (13/18) kalır. `text-read-utilities.test.ts`,
`app/`, `components/` ve `lib/`'i literal utility class için tarar ve dördüncü bir call site
eklendiği an build'i kırar; `border-utilities.test.ts`'in kendi kapalı listeleri için zaten
kullandığı aynı teknik.

`tabular-nums`, sayı column'larında, axis tick'lerinde ve tablo hücrelerinde — asla bir hero
figure veya bir stat-tile değeri üzerinde değil.

### Spacing, radius, elevation

| Sistem    | Değerler                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing   | `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 48`: 2px'lik bir half-step'e sahip 4px'lik bir base; dense bir satırı hayatta tutan şey bu half-step                                                                                                                                                                                                                                                                                                                      |
| Radius    | `sm 4` chip'ler · `md 6` button'lar, input'lar, kart'lar · `lg 10` panel'ler, dialog'lar · `full` avatar'lar. shadcn varsayılanından daha sıkı; büyük radius'lar yumuşak okunur ve kullanılabilir genişlikten çalar.                                                                                                                                                                                                                                                |
| Border    | 1px hairline `--border`; 2px yalnızca sancak rail'i, focus ring'ler ve task kartın kendi sol kenarı için (durağanken `--border`, kart seçiliyken `--signature`)                                                                                                                                                                                                                                                                                                     |
| Elevation | **Önce border'lar, en son shadow'lar.** Kart her zaman column ground'unun (`--muted`) bir adım üstündedir; column ground'un kendisi canvas'tan, o temanın tabanına doğru bir adım uzaklaşır: açık temada aşağı, koyu temada yukarı. Gerçek shadow'lar yalnızca üç yerde var, dialog'lar, popover'lar, drag preview, ve koyu temada üçü de shadow'un içinde 1px'lik bir `--border-strong` ring'i taşır, çünkü surface bu kadar koyuyken shadow tek başına okunmuyor. |

## 4. Yerleşim ve yoğunluk

App shell, [architecture.md §4](architecture.md#4-appsweb--yapı)'teki `(app)` route group'una
göre.

| Bölge                | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell yüksekliği     | Tam olarak `100dvh`, `overflow: hidden` — asla `min-height` değil. Her sayfa kendi scroller'ına sahiptir.                                                                                                                                                                                                                                                                                                                                                                                           |
| Sidebar              | 240px, üstte pinlenmiş workspace switcher; 1280px altında ve talep üzerine 56px'lik bir icon rail'ine collapse olur; 768px altında off-canvas                                                                                                                                                                                                                                                                                                                                                       |
| Topbar               | 48px sticky — board adı, filter girişi, overflow (presence avatar'ları henüz gelmedi); **768px altında 56px**, ve orada gezinme trigger'ını da taşır                                                                                                                                                                                                                                                                                                                                                |
| Board canvas         | Full-bleed, horizontal scroll; column header'ları vertical scroll'da sticky kalır                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Column               | 300px fixed (geniş ekranlarda 280 min / 320 max), 12px gap, isim + count + `⋯` içeren 40px sticky header (768px altında 48px); 48rem altında bir column 85vw'dir ve strip ona snap eder (mandatory scroll snap), scroll edilecek column'un kaldığı kenara 24px'lik edge mask (`--background`'dan transparent'a) çizilir                                                                                                                                                                             |
| Card                 | 8px 12px padding, artı drag grip'i için 32px sağ kanal (768px altında 48px); title bloğu ile meta satırı arasında 6px, meta satırının içindeki sinyaller arasında 8px; yalnızca title **36px**, tipik **56px** (tek meta satırı), clamp'te **76px**: title 2 satırda clamp'lenir, yani hiçbir kart bundan uzun olmaz. İlk üçü seed'deki board üzerinde ölçüldü; clamp değeri ise bunun için kurulan bir kartta ölçüldü: ikinci satıra taşacak kadar uzun bir title ve altında dolu bir meta satırı. |
| Card içerik sırası   | priority ikonu + title · meta satırı (label dot'ları, birleşik due date + estimate, assignee'ler), tek satır, asla iki değil                                                                                                                                                                                                                                                                                                                                                                        |
| List / table satırı  | 36px; 768px altında 44px                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Settings ve form'lar | 720px max width — prose okunur, taranmaz                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Touch target         | **768px altında 44px minimum**, her kontrolde, tek istisnası WCAG 2.5.5'in kendi istisnası: bir cümlenin içindeki, boyutunu çevresindeki metnin line-height'ından alan link (`/settings/members` üzerindeki e-posta kurulum linki, ölçülen 12/16)                                                                                                                                                                                                                                                   |

**Shell tam olarak bir viewport yüksekliğindedir ve bu taşıyıcı bir karardır.**
`min-height: 100dvh` "en az" der ve altındaki hiçbir şeyi sınırlamaz — yaptığı da buydu, ve
bir column'un `overflow-y-auto`'sunun neden hiç kırpmadığının sebebi budur: belge büyüyordu,
1 000 task'lık bir board'da 27 425px'e ulaşıyordu. Column başına scroll, sticky column header'ı
ve drag autoscroll'un üçü de column'un sınırlı bir kutuya sahip olmasına bağlı; dolayısıyla
üçü de işlevsizdi. `100vh` değil `100dvh`: telefonda `100vh`, browser chrome'u geri çekilmiş
haldeki viewport'tur, yani `vh` ile boyutlanmış bir shell ekrandan yüksektir ve ilk paint'te
topbar'ı adres çubuğunun altına iter. Yeni sayfa eklerken uyulacak sonuç: **uygulamanın hiçbir
yerinde belge scroll etmez**, bu yüzden `(app)` altındaki yeni bir route kendi
`flex-1 overflow-y-auto`'sunu bildirmek zorundadır — dashboard, settings ve notifications
sayfalarının yaptığı gibi.

**768px altında sidebar off-canvas'tır** — topbar'daki bir hamburger, aynı `SidebarBody`'yi
bir drawer'da açar; kendi link listesi olan ikinci bir gezinme değil. Drawer, uygulamanın
`Dialog` primitive'inin sol kenara sabitlenmiş hali (`DialogDrawerContent`), ve bu bilinçli
bir "elle yazmayı reddetme"dir: focus trap, `Escape`, focus'u trigger'a geri verme, arkadaki
sayfayı inert kılma ve scroll lock, bir off-canvas panelin bütün özüdür — paralel bir
implementasyon, bunlardan birinin eksik kalabileceği ikinci bir yerdir. 220ms'de
`--ease-drawer` ile kayar, `prefers-reduced-motion` altında ise kaymak yerine cross-fade eder.

**40 değil 44, ve pointer tipine değil genişliğe bağlı.** 44px, WCAG 2.5.5 (AAA) ve roadmap'in
bu yerleşimi tuttuğu rakam. `pointer: coarse` yerine drawer'ın kullandığı breakpoint'e —
`max-md` — bağlıdır: birbiriyle çelişebilecek iki koşul yerine tüm mobil yerleşimi tek bir
koşul yönetsin diye. Masaüstünde 360px genişliğinde bir pencerenin 44px hedef alması bir şeye
mal olmaz. Zemin, çağrı yerlerinde değil `Button` ile `Input` variant'larında ve dropdown item
sınıflarında yaşar; böylece okunacak tek bir liste vardır. Breakpoint üstündeki ölçüler
değişmez. Ve bu **iddia edilmez, ölçülür**: `e2e/tests/mobile-navigation.spec.ts`, 360px'te
board'daki ve drawer'daki her button, link, input ve menu item'ını tarar ve iki eksenden
birinde 44px'in altındaki her kutuda fail eder. jsdom hiçbir şeyi layout etmediği için bir
unit test bu iddiayı kuramaz.

**768px altında her metin field'ında 16px, üstünde `body`.** 44px dokunma tabanını
gerekçelendiren aynı iOS Safari davranışı, bir field 16px'in altında hesaplanırsa focus'ta
sayfanın tamamını da zoom'lar; Tailwind'in kendi `text-base`'i tam olarak bu eşik değerdir:
`Input`, `Textarea` ve `Select` üçü de `text-base md:text-body` taşır, bu yüzden kural, bir
primitif başına değil, bu bölümdeki her şeyle aynı `max-md` breakpoint'ine bağlıdır. Tıpkı 44px
tabanı gibi iki şekilde uygulanır: ölçülür, ve yapısal olarak geriye kaymayı zorlaştırır.
`e2e/tests/mobile-navigation.spec.ts`, 360px'te board'da, navigation drawer'da ve task
panel'de her field'ın hesaplanmış `font-size`'ını okur ve `16px`'in altındaki her şeyde fail
eder; `lib/utils.ts`'in `cn()`'i, `tailwind-merge`'ü bu tip ölçeğiyle genişletir, böylece bir
tüketicinin kendi `text-*` override'ı, ikisi birden DOM'a ulaşıp stylesheet sırasının hangisinin
boyanacağına karar vermesi yerine, bir primitifin varsayılanıyla yine tekilleşir.

**Touch'ta drag grip'ten yapılır.** Kart gövdesi column'un scroller'ına aittir — dnd-kit
listener'larını taşıyan wrapper'ın kendi `touch-action`'ı yoktur, dolayısıyla dikey bir
hareketi browser üstlenir — grip ise `touch-action: none` bildirir, ve o 44px'lik tek bölgeyi
dnd-kit'e veren şey budur. Bu bir kısıt değil, bir iş bölümüdür: başparmakla scroll edilemeyen
bir column, ortasından sürüklenemeyen bir karttan daha kötüdür. İki yarı da test edilir.
Dokunmatik drag ayrıca grip üzerinde **250ms'lik bir basışla** başlar (5px'lik hareket onu iptal
eder), böylece grip'ten başlayan bir kaydırma yine scroll eder; mouse drag'i ise gecikmesiz,
**6px'lik hareketle** başlar, çünkü mouse'un vazgeçecek bir hareketi yoktur.

**Task detayı: bir modal değil, sağ tarafta bir panel.** ~480px genişlik (CSS ile `min` 420px /
`max` 640px), **non-modal**: masaüstünde board arkasında görünür ve tıklanabilir kalır. Tailwind
`md` breakpoint'inin (768px) altında full-screen bir sheet'e dönüşür (`fixed inset-0`). Panel
genişliğinin drag ile yeniden boyutlandırılması uygulanmadı; CSS sınırları sabittir.
Confirmation'lar, board oluşturma ve destructive aksiyonlar **dialog** olarak kalır; onların
gerçekten block etmesi gerekir.

| Neden bir panel |                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context         | Bir board'un amacı çevresindeki kartlardır; bir modal onları siler                                                                                                            |
| Flow            | Triage open → edit → next'tir. Bir panel, bir dismiss artı bir click yerine, bir sonraki kartı tek bir click uzakta tutar.                                                    |
| Realtime        | Bir modal'ın altında hareket eden bir kart görünmezdir; bir panelin arkasında görünürdür                                                                                      |
| Routing         | `board/[boardId]/task/[taskId]`'te deep-linkable: hem soft navigation hem de hard load, task seçili halde `BoardView`'i render eder (Next.js intercepting/`@modal` route yok) |

**Bir durumun hangi surface'i aldığı.** Uygulamadaki her katman bunlardan birine cevap verir:

| Durum                                                                                                                                                                                       | Surface                                      | Kural                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kendi yerinde kaydedilen bir veya iki field, tam olarak tanımladığı noktadan açılır                                                                                                         | Inline composer / inline edit                | Layer yok, focus trap yok; `Enter` kaydeder, `Escape` iptal eder ve eski değeri geri yükler (`components/common/inline-rename.tsx`, `components/board/task-composer.tsx`, [ADR 0035](decisions/0035-inline-task-composer.md)) |
| Odaklı çok field'lı bir form, ya da arkasındaki ekranı gerçekten block etmesi gereken destructive veya geri alınması zor bir confirmation                                                   | Dialog                                       | Focus'u trap eder, `Esc`'te kapanır, kapanışta focus'u restore eder (§5, §9 Focus yönetimi); board ve column oluşturma, invite'lar, bir owner role değişimi, her delete                                                       |
| Bir entity'nin tam detayı, geldiği list'in yanında okunur veya edit edilir                                                                                                                  | Panel                                        | Non-modal, ~480px, `md` altında full-screen bir sheet (yukarıdaki "Task detayı")                                                                                                                                              |
| Bir ekranda birden fazla bağımsız settings-tipi section, 2 ile 7 arası                                                                                                                      | Tek sayfa, konu başına bir `SettingsSection` | `/settings` bugün altı tane taşıyor: members, language, notifications, tokens, workspace, account                                                                                                                             |
| Bu section'lardan biri kendi veri tablosu ölçeğine ulaşıyor (satır başına bir control taşıyan bir roster), ya da bir confirmation flow bir paragraf artı bir button'a sığmayacak kadar uzun | Sub-route                                    | `/settings/members`, `/settings/account/delete` (aşağıdaki Settings IA)                                                                                                                                                       |
| Ayrı bir üst düzey destination                                                                                                                                                              | Tam sayfa                                    | Kendi `flex-1 overflow-y-auto`'sunu taşır (yukarıdaki "Shell tam olarak bir viewport yüksekliğindedir")                                                                                                                       |
| Düz bir taramayı aşan bir seçenekler listesi                                                                                                                                                | Aşamalı açılım (progressive disclosure)      | 7 veya daha az düz render edilir; 8 veya daha fazlası aşağıdaki searchable bir popover'ın arkasına katlanır                                                                                                                   |
| Ekranın kendisinin zaten gösteremediği bir aksiyonun sonucu                                                                                                                                 | Toast                                        | §7'nin üçüncü vuruş kuralına göre: etki ekran dışında, ekranda bir karşılığı yok, ya da view'ın kabul ettiğinden daha uzağa uzanıyor                                                                                          |
| Field-level bir `400` veya `422` failure'ı                                                                                                                                                  | Inline hata                                  | Field'ın altında, focus ilkine gider (§6 Error'lar)                                                                                                                                                                           |

**Kaç dialog var ve bu nasıl sayılıyor.**
`find apps/web/components -iname '*dialog*.tsx' ! -iname '*.test.tsx'` bütün listeyi verir;
dosyalarından dördü kimsenin karşılaşmadığı bir dialog değildir ve sayıdan düşer: `ui/dialog.tsx`
primitifi, `common/form-dialog.tsx` ile `common/confirm-dialog.tsx` sarmalayıcıları, ve yalnızca
board'un kendi dialog'larını mount eden `board/board-dialogs.tsx`. Geriye **15 somut dialog**
kalıyor; bu faz başlarken 19'du: bir board'u ve bir workspace'i yeniden adlandırmak satır içi
düzenlemeye, rol değiştirmek ile hesap silmek de yukarıdaki iki alt rotaya taşındı. Her düşüş bir
yüzeyin rubrikte aşağı inmesiydi, sayı için silinen bir dialog değil.

**Panel sırası.** `TaskPanel`, yukarıdan aşağı şunları compose eder: `TaskPanelFields` (title
`md` ve üzerinde `title-lg`'de, description ise `read`'de, `md` altında ikisi de 16px; title
durağanken borderless ve yalnızca focus'ta border'lı, `border-transparent focus:border-input`
üzerinden), `TaskPropertiesPanel` (priority, due date, estimate, assignee'ler, label'lar),
`TaskChecklists`, `TaskAttachments`,
`TaskDiscussionPanel` (comment'ler, activity), ardından, mutate edebilen herkes için, bir delete
footer'ı. Bu, kartın kendisinin okuduğu aynı sıra: önce task'ın ne olduğu, sonra içinde ne
olduğu, sonra hakkında ne söylendiği. Footer `mt-auto`'dur ve yalnızca o flex column'un son
child'ı olduğu sürece panelin altına ulaşır (`components/task/task-panel.tsx`,
`task-panel.test.tsx` tarafından sabitlenmiş), bu yüzden ardına hiçbir şey eklenemez.

Field'ların altındaki başlıklı her section aynı 1px üst çizgiyi 16px padding ile taşır. Dördü de,
ikisi değil: aynı ağırlıkta dört başlığın yalnızca ikisinin üstünde çizgi olması gruplama gibi
değil, keyfi bir çizgi gibi okunuyor. Ve panel kendi adına **hiç** tam güç bakır harcamaz. Section
aksiyonları (label oluştur, checklist ekle, comment gönder) outline button'dır, çünkü bunlar
§2'nin bütçelediği tek birincil aksiyon değil üç eşittir, ve panelin arkasındaki board ekranın
diğer işaretini zaten seçili kartın rail'ine harcıyor. `task-panel.test.tsx` panelin herhangi bir
yerindeki default varyant button'da kırılır.

Assignee ve label picker'ları, panelin kendisinin search'süz taradığı aynı sayıda katlanır:
`INLINE_PICKER_MAX = 7` (`components/task/searchable-picker.tsx`), 7 veya daha az seçeneği düz
bir checkbox listesi olarak render eder ve 8 veya daha fazlasını, listenin panelin kendi
genişliğini aşmasına izin vermek yerine, searchable, non-portalled bir popover'ın arkasına katlar
(`components/ui/popover.tsx`). `Escape` yalnızca o popover'ı kapatır, arkasındaki paneli değil
(`use-task-panel-focus.ts`'teki `ESCAPE_LAYER_SELECTOR`).

**Settings IA: aşağı indikçe, geri alınması zorlaşıyor.** `/settings`'in section'ları bu kurala
göre yukarıdan aşağı okunur. Önce members, çünkü başka insanlar hakkındaki tek section o ve yeni
bir workspace owner'ının bu ekranda bulmaya geldiği şey de o. Sonra language ve notifications,
ikisi de workspace'ten çok kişiyle ilgili. Workspace'ten önce tokens, çünkü bir token'ı revoke
etmek, yeniden mint edilir edilmez kendini geri alıyor, altındaki hiçbir şeyin yapamadığı bir
şey. Account'tan önce workspace, çünkü bir workspace'i silmek onun içinde kalırken account'u
silmek bu workspace'in ötesine, kişinin bu instance'ta bulunduğu her workspace'e uzanıyor
([ADR 0026](decisions/0026-account-deletion-anonymisation.md)); sayfada bundan daha aşağısı yok.
`/settings/members` ve `/settings/account/delete`, yukarıdaki sub-route kuralının bu sayfadan
çıkardığı iki section. Diğer her section inline bir `SettingsSection` olarak kalır
(`components/settings/settings-section.tsx`).

## 5. Etkileşim kalıpları

| Drag and drop | Kural                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lift          | Kart `1.02`'ye scale olur, `1deg` tilt olur, tek drag shadow'u alır; source, aynı yükseklikte bir `--muted` ghost bırakır, böylece board drag ortasında asla reflow olmaz                                                                                                                                                             |
| Drop target   | Column içinde dnd-kit'in displacement'ı kart yüksekliğindeki gap'i açar ve 2px'lik bakır rail onun leading edge'ini işaretler; column'lar arasında yalnızca rail insertion noktasını gösterir, hiçbir şey kaymaz. Destination column bir `--signature-subtle` wash alır. Dashed outline yok.                                          |
| Commit        | Optimistic — kart anında yerine oturur, ardından `PATCH .../tasks/:taskId/position` gelir                                                                                                                                                                                                                                             |
| Failure       | Rollback pozisyonu anında geri alır, kart ise 220ms `--ease-in-out` bir oturmayla yerine iner (`translateY` -6px'ten 0'a, opacity 0.5'ten 1'e); bir toast, bir **Try again** (**Tekrar dene**) kontrolüyle ne olduğunu söyler. Optimistic state hiçbir zaman öylece bırakılmaz.                                                       |
| Keyboard      | `@dnd-kit` `KeyboardSensor` — `Space` lift yapar, arrow'lar column içinde ve column'lar arasında taşır, `Space` drop yapar, `Esc` cancel eder. Her transition `aria-live="polite"` üzerinden duyurulur: "Moved _Fix login redirect_ to In Progress, position 2 of 5." ("_Fix login redirect_ In Progress'e taşındı, pozisyon 2 / 5.") |
| Autoscroll    | Her iki axis, 24px edge zone                                                                                                                                                                                                                                                                                                          |

| Realtime değişikliği   | Surfacing (asla bir layout jump)                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote create / update | 1200ms boyunca fade out olan bir `--signature-subtle` background. Hareket yok, size değişimi yok. Yalnızca renk, böylece `prefers-reduced-motion`'dan değişmeden çıkar.                                                                                        |
| Remote move            | Kart, column'un kendi sortable transition'ı ile hareket eder (dnd-kit'in 200ms varsayılanı); local bir drag sırasında update queue'lanır ve drop'ta uygulanır                                                                                                  |
| Remote delete          | **Henüz gelmedi:** kart gider ve gap aynı sortable transition ile kapanır. Olması gereken iki beat, 160ms'te 0'a fade ve ardından 160ms'te gap'in kapanması, hâlâ hedeflenen biçim                                                                             |
| Presence · disconnect  | Henüz gelmedi (topbar/kart presence'ı). Disconnect: sessiz, inline bir "Connection lost, changes may not be showing" ("Bağlantı koptu, değişiklikler görünmüyor olabilir") bar'ı, socket geri gelene kadar duruyor ve kapatılamıyor, asla blocking bir overlay |

**Keyboard baseline.** Focus her zaman görünürdür, ve tam olarak tek bir göstergedir: 2px offset'te
2px `--ring`, ve bir replacement olmadan `outline: none` bir review blocker'dır. O tek işaret,
`@layer base`'den, her keyboard'la ulaşılabilir kontrolde bir kez çizilir: primitiflerin yanında
duran `focus-visible:ring-[3px] ring-ring/50` ve `focus-visible:border-ring` class'ları kalktı, ve
katmanlı kuralı ezecek her `outline-none` / `outline-hidden` de kalktı. Bunlardan geriye kalan,
script ile focus alan (Tab, bir arrow key veya bir link ile değil) kısa bir programmatic focus
container listesidir (bir dialog'un content'i, drawer), artı bir dropdown row'u, skip link'in `main`
hedefi ve task panel'in heading'i; üçü de bastırılmış değil, herkesle aynı base outline'ı çizer. Hem
invalid hem focus'ta olan bir field, kenarın yanına ikinci bir işaret büyütmek yerine o tek
outline'ı `--destructive`'e boyar (`[aria-invalid='true']:focus-visible`); border'ın yanında renkli
bir ring'i de tutmak önceki plandı, Tailwind v4'ün bir ring-width class'ı yanında olmadan bir
ring-color class'ından hiçbir şey boyamadığı ortaya çıkınca bu plandan vazgeçildi. Offset yalnızca
focus alan bölge shell'i doldurduğunda ve dıştaki bir offset kırpılacağında içeri döner; bugün bu
yalnızca skip link'in `main` hedefidir. O işaret ayrıca hiçbir zaman transition edilmez: Tailwind
v4, `outline-color`'ı `transition-colors`'ın içine koyar (v3 koymuyordu), yani `transition-colors`
veya `transition-all` gibi bir kısayol, outline'ın genişliği ve offset'i tek karede belirirken
rengini `currentColor`'dan bakıra transition süresi boyunca yavaşça geçirir. Bu yüzden ağaçtaki
her transition kendi property'lerini tek tek yazar ve o listelerin hiçbirinde outline yoktur. Tab order visual order'ı takip eder; board bir composite
widget'tır, bu yüzden column strip'inin tamamı tek bir tab stop'tur, `Home`, `End` ve `Ctrl` +
arrow onun içindeki column heading'leri arasında gezer, çıplak arrow tuşları ise bir column
içindeki klavye drag'ine aittir. `Esc` yalnızca en üstteki layer'ı kapatır ve focus'u onu açan
şeye geri verir. `c` map edilmiştir: bir column'un dibindeki oluşturma composer'ını açar
([ADR 0035](decisions/0035-inline-task-composer.md)). Şimdiden reserve edilmiş, Faz 4+'ta map
edilecek: `⌘K` command palette, `/` filter, `?` help; başka hiçbir şey çıplak bir letter key
talep etmez.

**Dialog'lar sınırlıdır ve kendi gövdelerini scroll eder.** Bir dialog yüzeyi en fazla
`calc(100dvh - 4rem)` yüksekliğindedir; gövdesi scroll olur, header ve footer o scroll'un dışında
sabit kalır, böylece submit ve cancel kontrolleri her pencere yüksekliğinde ve §9'un istediği
%200 zoom'da ekranda kalır. Açık bir dialog'un arkasındaki sayfa scroll kilidi altındadır, yani
tavanı olmayan bir yüzey kendi footer'ını ekranın altına iter ve ona ulaşmak için scroll edilecek
hiçbir şey kalmaz. Kapatma kontrolü scrollport'un içine değil, header ile birlikte sabitlenir:
absolute konumlanmış bir kutu, scroll container'ının içinde içerikle birlikte kayar ve onun
tarafından kırpılır.

**Motion.** Yalnızca amaçlı micro-interaction'lar, **view başına en fazla bir orchestrated an** —
board'da bu, column'ların ilk paint'idir, başka hiçbir şey değil.

| Durum                                                    | Süre                          | Curve                                                     |
| -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Sancak rail'inin hareketi                                | 150ms                         | `--ease-out`                                              |
| Tooltip, küçük popover                                   | 125–200ms                     | `--ease-out`                                              |
| Dropdown, select, menu                                   | 150–250ms                     | `--ease-out`, `transform-origin: var(--transform-origin)` |
| Detay paneli, sheet                                      | 220ms                         | `--ease-drawer`                                           |
| Dialog · toast (`translateY(100%)`)                      | 200ms                         | `--ease-out`, dialog origin ortalanmış                    |
| Dialog perdesi                                           | 200ms                         | `--ease-out`                                              |
| Başarısız bir drop'tan sonra kartın geri dönmesi         | 220ms                         | `--ease-in-out`                                           |
| İlk board paint'inde column stagger'ı                    | column'lar arası 40ms         | `--ease-out`                                              |
| Skeleton pulse (loop, tek seferlik bir transition değil) | 1.6s, opaklık 1.0 → 0.6 → 1.0 | `--ease-in-out`                                           |

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* entering, exiting, default */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* panel and sheet */
```

Yukarıdaki üç curve artık `app/globals.css` içinde gerçek birer custom property, `@theme
inline` üzerinden Tailwind `ease-out`, `ease-in-out` ve `ease-drawer` utility'leri olarak da
erişilebilir, yalnızca bu tablonun notasyonu değil. Dialog yüzeyi ve perdesi, dropdown ve
submenu, off-canvas drawer, keyframe'lerini bir Tailwind animation plugin class'ı yerine
`app/globals.css` içinde `data-slot`/`data-state` üzerinden bağlar, çünkü bu proje düz
`tailwindcss` kullanır, böyle bir plugin yok: o class'lar hiçbir CSS üretmezdi ve her açılış
transition yerine kesme olurdu.

- **Press feedback ship edilmedi.** Hiçbir şey `:active` üzerinde ölçeklenmiyor; basılan bir
  kontrol yalnızca renk adımı değiştirir ve yerinde kalır. Yukarıdaki tablo uygulamanın çizdiğidir,
  çizebileceği değil.
- **Keyboard-initiated aksiyonlarda animasyon yok** — command palette anında açılır; günde yüz
  kere çalışır ve motion onu yavaş hissettirir.
- **Yalnızca `transform` ve `opacity`** (accordion height hariç). Asla `transition: all`, asla
  `scale(0)` — `scale(0.96)` + `opacity: 0`'dan enter et. UI'de asla `ease-in`: kullanıcının tam
  o an izlediği ana gecikme getirir.
- Saniyede iki kez tetiklenebilecek her şey için (toast'lar, toggle'lar, rail) **keyframe değil
  transition** — transition'lar mevcut değerden retarget eder, keyframe'ler sıfırdan yeniden
  başlar.
- Panel hariç 300ms'i geçen hiçbir şey yok. Hover motion'ı `@media (hover: hover) and
(pointer: fine)`'ın arkasına gate'le. Spring'ler (`{ duration: 0.5, bounce: 0.2 }`) yalnızca
  bir gesture'ın velocity taşıdığı yerlerde — drag preview, swipe-to-dismiss.
- **Loop indicator'lar "300ms'i geçen hiçbir şey yok" kuralının dışında**: bir skeleton'un
  pulse'ı (1.6s, opaklık 1.0'dan 0.6'ya ve geri) ve loading bir button'ın spinner'ı (rotation
  başına 700ms, linear, yalnızca 400ms sonra görünür), work devam ederken enter veya exit'te bir
  kez değil sürekli çalışır. İkisi de `prefers-reduced-motion: reduce` altında hareketsiz kalır:
  skeleton sabit 0.75 opaklıkta, spinner ise hiç dönmeden.
- **Bir yanıt beklenirken tam olarak tek bir mekanizma çalışır**: `Button`'ın `loading` prop'u,
  `aria-busy` ve `disabled` anında, spinner 400ms eşiğinden sonra, control'ün kendi içeriğinin
  üzerine ve layout akışının dışına çizilerek, böylece button kutusunu birebir korur ve hiçbir
  label kaymaz (tam şekli §6'da). Hiçbir screen bir control'ün label'ını kendi "sending"
  ("gönderiliyor") string'ine boyamaz.
- **`prefers-reduced-motion: reduce`** hareketi düşürür ve opacity ile rengi korur: panel
  cross-fade olur, rail zıplar, highlight değişmeden kalır. Daha az ve daha nazik, sıfır değil.

## 6. Durumlar

**Empty state'ler birer davettir** — screen başına bir damga mark'ı ve bir primary action. Bir
sonraki hamleyi adlandırırlar; feature'ı açıklamazlar. Damga mark'larının göründüğü tek yer
burasıdır.

**Bir primary action, tüm ekranda bir tane demektir.** Aksiyonu empty state taşıyorsa, sayfa
başlığındaki aynı aksiyonun kopyası ekran boşken gizlenir ve ilk satırla birlikte geri gelir.
İlk çalıştırmada birbirinin aynısı iki primary buton, okuyucunun sahip olmadığı bir seçimdir.

Dashboard, iki bölgesinin aynı anda boş olabildiği tek ekran, ve oradaki iki aksiyon aynı aksiyon
değil: board varken hiç task yoksa, chart'lar "Open a board" davetini taşırken altındaki board
listesi kendi sabit "Create board"unu taşımaya devam ediyor. Çalışan uygulamada ölçüldü: ikisi de
dolguyu çiziyordu, bu da kenar çubuğundaki rail ile birlikte tek ekrana üç tam güç işaret koyuyor.
Dolgu, rotanın her durumda taşıdığı aksiyonda kalıyor, dolayısıyla chart'ların kısayolu outline bir
button (`components/dashboard/dashboard-summary.tsx`).

| Surface                           | Mark       | Headline                                                       | Body                                                                                                                                                                                                                                                              | Action                                                                         |
| --------------------------------- | ---------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Henüz board yok                   | Damga 96px | No boards yet (Henüz board yok)                                | A board is where the work gets divided. Start with one. (Bir board, işin bölüştüğü yerdir. Bir tane ile başlayın.)                                                                                                                                                | Create board (Board oluştur)                                                   |
| Board'da column yok               | Damga 96px | This board has no columns (Bu board'da column yok)             | Columns are the stages work moves through. Start with To Do, In Progress, and Done, or name your own. (Column'lar, işin içinden geçtiği aşamalardır. To Do (Yapılacak), In Progress (Devam Ediyor) ve Done (Bitti) ile başlayın, ya da kendi isimlerinizi verin.) | Add column · Use default columns (Column ekle · Varsayılan column'ları kullan) |
| Boş column                        | —          | —                                                              | 56px solid `--border-strong` drop zone: "Drop a task here" ("Bir task'ı buraya bırakın")                                                                                                                                                                          | Add task (Task ekle)                                                           |
| Filtreler hiçbir şeyle eşleşmiyor | —          | No tasks match these filters (Bu filtrelerle eşleşen task yok) | Three filters are active. (Üç filtre aktif.)                                                                                                                                                                                                                      | Clear filters (Filtreleri temizle)                                             |
| Dashboard, veri yok               | Damga 64px | Nothing to chart yet (Henüz grafiklenecek bir şey yok)         | Charts fill in as tasks are created and moved. (Task'lar oluşturuldukça ve taşındıkça grafikler dolar.)                                                                                                                                                           | Open a board (Bir board aç)                                                    |
| Bildirimler                       | —          | You're caught up (Her şeyi gördünüz)                           | —                                                                                                                                                                                                                                                                 | —                                                                              |

**Loading**, `--accent` içinde final layout'a uyan skeleton'lar kullanır, 1.6s'lik bir opacity
pulse'ı ile (1.0 → 0.6) ve shimmer sweep olmadan: board, gerçek genişlikte column skeleton'ları
render eder, gerçek kart yükseklikte üç kart skeleton'ıyla birlikte; task paneli, tıklanan kartın
title'ı zaten yerindeyken anında açılır, böylece asla boş görünmez; inline aksiyonlar
optimistic'tir. Spinner'lar tam olarak tek bir yerde var: basılı bir button'ın içinde, 14px,
400ms sonra içeriğinin üzerine geçerek. List içeriği asla bir tane almaz. Bilinmeyen uzunluktaki iş
(import, export) count'lu bir progress bar alır.

**Error'lar**, [api-conventions.md](api-conventions.md#hatalar)'daki problem-JSON şeklinden
türer. O contract'a göre UI **`statusCode` ve `error` üzerinden branch'lenir, asla `message`
metni üzerinden değil** — bu yüzden kullanıcıya görünen string'ler i18n katalogundan gelir ve API
`message`'ı gösterilmez, loglanır. Yalnızca `details[]` surface edilir, çünkü field-level ve
güvenlidir. Başarısız olan object'i adlandırın, bir sonraki aksiyonu gerçek bir control olarak
verin, tek bir cümlede tutun ve asla bir id, bir stack trace, ya da "Oops" kelimesini
yazdırmayın.

| Status                         | Surface                                           | Metin                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` / `422`, `details[]` ile | Her field'ın altında inline; focus ilkine gider   | `details[].constraint`'ten, bir katalog string'ine map'lenir: "Title can't be empty" ("Title boş olamaz")                                                                                |
| `401`                          | Return URL'i koruyarak sign-in'e redirect         | Your session ended. Sign in to pick up where you left off. (Oturumunuz sona erdi. Kaldığınız yerden devam etmek için giriş yapın.)                                                       |
| `403`                          | Block edilen control üzerinde inline              | You need admin access to change columns. Ask a workspace owner. (Column'ları değiştirmek için admin erişimine ihtiyacınız var. Bir workspace owner'ından isteyin.)                       |
| Panelde `404`                  | Panel body'sinin yerini alır                      | This task no longer exists. Someone may have deleted it. (Bu task artık mevcut değil. Biri onu silmiş olabilir.) → **Back to board** (**Board'a dön**)                                   |
| `409`                          | Stale editor üzerinde dialog                      | Someone changed this task while you were editing. (Siz düzenlerken birisi bu task'ı değiştirdi.) → **Reload** (**Yeniden yükle**) · **Copy my changes** (**Değişikliklerimi kopyala**)   |
| `429` · `5xx`                  | Toast · içeriğin olması gereken yerde error block | Too many requests. Try again in a few seconds. (Çok fazla istek. Birkaç saniye içinde tekrar deneyin.) · The board couldn't load. (Board yüklenemedi.) → **Try again** (**Tekrar dene**) |
| Offline                        | Kalıcı topbar strip'i                             | You're offline. Changes won't save until the connection is back. (Çevrimdışısınız. Bağlantı geri gelene kadar değişiklikler kaydedilmeyecek.)                                            |

## 7. UI metni

Ekranın kullanıcı tarafından, active voice, sentence case.

| Bunun yerine                                             | Şunu yaz                                                                                        | Neden                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Submit (Gönder)                                          | Save changes (Değişiklikleri kaydet)                                                            | Ne olacağını söyler                         |
| Oops! Something went wrong (Hata! Bir şeyler ters gitti) | The board couldn't load. (Board yüklenemedi.)                                                   | Object'i adlandırır                         |
| Task successfully created! (Task başarıyla oluşturuldu!) | Task created (Task oluşturuldu)                                                                 | Button'ın verb'i, ünlem yok                 |
| Are you sure? (Emin misiniz?)                            | Delete this board? (Bu board'u sil?)                                                            | Soru, sonucun kendisidir                    |
| Invalid input (Geçersiz giriş)                           | Title can't be empty (Title boş olamaz)                                                         | Spesifik olmak akıllı olmaktan iyidir       |
| Users / Org / Entity                                     | Members / Workspace / Task                                                                      | Schema değil, product vocabulary'si         |
| Socket disconnected (Socket bağlantısı kesildi)          | Connection lost, changes may not be showing (Bağlantı koptu, değişiklikler görünmüyor olabilir) | Onlara neye mal olduğu, neyin düştüğü değil |
| Position updated (Pozisyon güncellendi)                  | Moved to In Progress (In Progress'e taşındı)                                                    | Row'un değil, kullanıcının ne yaptığı       |

- **Bir flow boyunca tek bir verb:** button **Create board** (**Board oluştur**) → dialog
  **Create board** (**Board oluştur**) → toast **Board created** (**Board oluşturuldu**).
  Button'lar aksiyonlarını adlandırır, asla Yes/No/OK değil; destructive olanlar object'i
  adlandırır. Verb, failure'a kadar korunur: bir **Add column** (**Column ekle**) button'ı
  "Could not _create_ this column." ("Bu column _oluşturulamadı_.") diye başarısız olmaz.
- **Üçüncü vuruş yalnızca ekranın sonucu gösteremediği yerde vardır.** Bir card cursor'ın altına
  iner, yeniden adlandırılmış bir column yeni adını gösterir, silinen bir board grid'den çıkar —
  bunlar kendilerini doğrular, üstüne bir toast gürültüdür. Etki ekran dışındaysa (bir inbox,
  saklanan bir tercih), değişen şeyin ekranda bir karşılığı yoksa (bir column'ın `category`'si),
  ya da değişiklik view'ın kabul ettiğinden daha uzağa uzanıyorsa (bir board label'ını silmek onu
  her task'tan çıkarır) doğrula. Sessizlik default'tur; mesaj, kendini hak etmesi gereken
  istisnadır.
- **Element başına bir görev.** Bir label label'lar, helper text açıklar, bir placeholder bir
  örnek gösterir — bir placeholder asla bir label değildir.
- **Internal'ları asla ifşa etme** (`workspaceId`, `position`, "fractional index", "optimistic
  update"). Id'ler yalnızca bir copy-id affordance'ının arkasında, mono'da görünür.
- **Date'ler ve süreler:** şimdiye yakın relative ("in 2 days" / "2 gün içinde"), bir haftadan
  öte absolute, exact değer her zaman `title`'da. `estimatedMinutes`, asla "150" değil "2h 30m"
  ("2s 30dk") render eder.

**Her error bir çıkış yoluyla biter.** Başarısız olan object'i adlandırmak mesajın yalnızca
yarısıdır; diğer yarısı bir sonraki hamledir. Bunu hangi yarının taşıdığına tek bir soru karar
verir — **aynı request ikinci bir denemede başarılı olabilir mi?**

|                       | **Hayır** — server kendini açıkladı                                                                                                                | **Evet** — server açıklamadı                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Recovery nerede yaşar | **Cümlede**                                                                                                                                        | **Surface'te**                                                                         |
| Kullanıcı ne alır     | Sebep, ardından onu değiştiren tek hamle: bir admin'e sor, reload et, diğer adresi kullan, yeni bir link gönder                                    | Başarısız olan object, ardından bir control: toast'ta `action`, block'ta **Try again** |
| Tipik sebepler        | `400` · `401` · `403` · `404` · `409`, reddedilen bir credential, süresi dolmuş bir link                                                           | network · timeout · `429` · `5xx`                                                      |
| Örnek                 | You need admin access to change columns. Ask a workspace owner. (Column'ları değiştirmek için admin erişimi gerekir. Bir workspace owner'ına sor.) | The board couldn't load. → **Try again** (Board yüklenemedi. → **Yeniden dene**)       |

Sağdaki sütunu iki şey dürüst tutar. Her basışta yeniden başarısız olan bir control, kullanıcıya
ürünün bozuk olduğunu öğretir; bu yüzden **açıklanmış** bir failure asla control almaz — server'ın
`403` ile reddettiği bir write'ı, ya da artık var olmayan bir task'a yapılan bir write'ı yeniden
göndermek yalnızca toast'ı tekrarlar. Ve başarısız olan control **hâlâ ekrandaysa ve hâlâ
canlıysa** — bir dialog'un submit button'ı, "Load more", bir select — retry zaten odur; yanına bir
ikincisini koymak karmaşadır. Create/rename/delete dialog'larının kendi action'ını taşımamasının
sebebi budur.

Kullanıcıya görünen her string, MVP English-only ship etse bile, ilk component'ten itibaren
**next-intl** üzerinden geçer. Bu _layer_'dır, çeviriler değil: roadmap'in Beyond-MVP "i18n in
the application UI" ("uygulama UI'sinde i18n") satırı daha fazla language pack ship etmekle
ilgilidir, ve plumbing Faz 1 skeleton'uyla birlikte gelir çünkü onu sonradan eklemek, onunla
başlamaktan çok daha pahalıya mal olur.

| i18n kuralı                      |                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcode edilmiş string yok      | JSX'te bir string literal bir lint error'dur. Server component'lerde `getTranslations`, client olanlarda `useTranslations`.                                   |
| Key'ler                          | Domain'e göre, component tree'yi mirror'layarak: `board.column.addAction`, `task.priority.urgent`, `errors.http.409`                                          |
| Kataloglar                       | `messages/en.json` kanoniktir; `messages/tr.json` onun yanında gelir ve `messages/catalog.test.ts`, birinde olup diğerinde olmayan bir key'de build'i düşürür |
| Plural'lar, interpolation        | ICU format (`{count, plural, …}`). Cümle parçalarını asla concat etme — word order dilden dile değişir.                                                       |
| Date'ler, sayılar, relative time | Aktif locale ile next-intl formatter'ları üzerinden `Intl.*`; elle formatlanmış date yok                                                                      |
| Casing                           | **Çevrilmiş string'lerde `text-transform: uppercase` yok** — Turkish `i → İ`, CSS casing altında bozuluyor. İstenen casing'i doğrudan kataloğa yaz.           |
| Layout                           | ±35% string uzunluğu varsay; İngilizcesi sığıyor diye hiçbir şey fixed pixel width olmasın                                                                    |

## 8. Grafikler ve dashboard

Dashboard için ([ROADMAP.md](../../ROADMAP.md#shipped-mvp-summary), Faz 7), Recharts ile render edilir. Form, herhangi bir renk
kararından önce, reader'ın job'ına göre seçilir. Asla dual bir y-axis, asla iki slice'ı geçen bir
pie, asla generate edilmiş bir dokuzuncu ton — tail'i "Other" ("Diğer") içine katla ya da small
multiple'lara facet'le.

| Aggregate                                        | Form                                                                                             | Renk görevi                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| Open task'lar, overdue count, bu hafta completed | **Stat tile** — label, value, adlandırılmış bir periyoda karşı signed delta, opsiyonel sparkline | none / emphasis                  |
| Zaman içinde completion                          | **Line**, tek series (yalnızca yalnızsa 10% area fill)                                           | sequential                       |
| Zaman içinde created vs completed                | **Two lines**, sağ kenarda direct-labeled                                                        | categorical 1–2                  |
| Column başına · assignee başına task             | **Horizontal bar**, sorted; assignee'ler top 8 sonra "Other" ("Diğer")                           | sequential                       |
| priority breakdown'ı                             | **Horizontal stacked bar**, tek satır, LOW→URGENT                                                | priority skalası (§3)            |
| Label distribution'ı                             | **Horizontal bar**                                                                               | categorical, label slot'una göre |
| Zaman içinde column composition'ı                | **Stacked area / column**, ≤ 6 series                                                            | categorical                      |
| Hepsi önemli olan ~7'den fazla category          | **Table**, ya da table artı chart                                                                | —                                |

Palette, Kurul'un kendi surface'lerine karşı validate edildi (`#FFFFFF` açık, `#212523` koyu).
Bu slot'lar aynı zamanda `Label.color`'ın arkasındadır.

| Slot | Ton     | Açık      | Koyu      |     | Slot | Ton     | Açık      | Koyu      |
| ---- | ------- | --------- | --------- | --- | ---- | ------- | --------- | --------- |
| 1    | mavi    | `#2A78D6` | `#3987E5` |     | 5    | macenta | `#E87BA4` | `#D55181` |
| 2    | turuncu | `#EB6834` | `#D95926` |     | 6    | yeşil   | `#008300` | `#2A9D3C` |
| 3    | turkuaz | `#1BAF7A` | `#199E70` |     | 7    | mor     | `#4A3AA7` | `#9085E9` |
| 4    | sarı    | `#EDA100` | `#C98500` |     | 8    | kırmızı | `#E34948` | `#E66767` |

Validator — **açık**: lightness band, kroma, CVD (worst adjacent ΔE 9.1) ve normal-vision (19.6)
hepsi PASS; slot 2, 3, 4, 5'te contrast WARN (2.61 / 2.29 / 1.76 / 2.19, signature tint üzerinde
bir dot olarak 3:1'in altında, `app/globals.contrast.test.ts`'in bir label chip'i karşı ölçtüğü en
kötü ground). Dot asla tek kanal değildir: `aria-hidden`'dır ve her zaman label'ın kendi ismiyle
eşleşir, ve bu slot'ları taşıyan her chart hâlâ **direct label'lar veya table view**'ı relief
route olarak sunar. **Koyu**: lightness band, kroma, normal-vision (worst adjacent ΔE 19.3) ve
koyu surface'e karşı contrast PASS; CVD separation ise worst adjacent ΔE 7.2 ile (deutan, slot 5
macenta ile slot 6 yeşil arasında) 6 ile 8 arasındaki floor band'ine düşüyor, slot 6 koyu
surface'lerde 3:1'i geçmek için `#2A9D3C`'ye taşındıktan sonra yeniden hesaplandı. O band yalnızca
ikinci bir kanalla legaldir ve bu slot'ların her kullanımı o kanalı zaten taşıyor: chip'te label'ın
kendi ismi, chart'ta legend artı direct label'lar ya da table view.

| Kural                    |                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slot ataması             | Fixed order, sırayla assign edilir, **asla cycle'lanmaz**. Renk, rank'ini değil entity'yi takip eder — bir series'i filtrelemek, kalanları repaint etmemeli.                                                                                                                                     |
| Series cap'i             | Bar'lar, line'lar, stack'ler için 6 soft / 8 hard; scatter, bubble ve small multiple'lar için **3** (all-pairs gate)                                                                                                                                                                             |
| Sequential · diverging   | Magnitude için tek bir ton, mavi, açık→koyu · **neutral gray** (`#F0EFEC` / `#383835`) midpoint'li mavi ↔ kırmızı, yalnızca "vs target" view'ları için                                                                                                                                           |
| Emphasis                 | `--signature` bakırında tek bir series, kalanı `--label-slot-1`'da. Bir chart'taki tek bakır, ve story "this one" ("bu") olduğunda doğru cevap.                                                                                                                                                  |
| status ve priority       | Reserved — asla "series 4" olarak reuse edilmez                                                                                                                                                                                                                                                  |
| Mark'lar                 | Bar'lar ≤ 24px kalınlığında, 4px rounded data-end, baseline'da square, adjacent bar'lar ve stacked segment'ler arasında 2px surface-colored gap; line'lar 2px round cap/join; marker'lar ≥ 8px, 2px'lik bir surface ring'iyle                                                                    |
| Grid ve axis'ler         | Yalnızca horizontal gridline, 1px solid `--border`, asla dashed değil. Chart border yok, background fill yok. Tick'ler temiz sayılara rounded, thousands-separated, `tabular-nums`, `--muted-foreground`'da.                                                                                     |
| Legend ve label'lar      | 2+ series'te legend her zaman var, tek series'te yok — title onu zaten adlandırıyor. Direct label'lar selective'tir (endpoint, extreme, ya da story olan tek series), asla her point'te bir sayı değil. **Metin text token giyer, asla series ton'unu değil**; identity yanındaki dot'tan gelir. |
| Tooltip                  | Default-on: line ve area'da crosshair + tooltip, bar ve cell'de per-mark. Card surface, 1px border, `sm` radius, 8px padding, series dot'u + name + `tabular-nums` value, mark'tan daha büyük bir hit target.                                                                                    |
| Filter'lar ve table view | Filter'lar chart'ların üzerinde tek bir satırda, asla bir chart'ın içinde değil. Her chart'ın bir "View as table" ("Tablo olarak görüntüle") affordance'ı var — aynı zamanda light-mode contrast WARN'ı için relief channel.                                                                     |

**Stat tile'lar.** `small` `--muted-foreground`'da label, sentence case, sondan colon yok ·
**proportional** figure'larla, auto-compacted (`1,284` / `12.9K`) 28px'te Archivo 600'de value ·
adlandırılmış bir periyoda karşı signed delta, _direction × whether up is good_'a göre renklenir
(daha fazla overdue task iyi haber değildir) ve bir arrow'la eşleşir · `--muted-foreground`'da
opsiyonel 12-point sparkline, current period bakırda. **View başına en fazla bir hero figure**,
≥48px, Archivo'da — asla Fraunces'te; bir sayının üzerindeki bir display face, dekorasyon gibi
okunur.

## 9. Erişilebilirlik

Her iki temada da **WCAG 2.1 AA**'yı hedefle, screenshot başına değil token pair'i başına
verify edilmiş olarak.

| Gereksinim                               | Taban                                    | Uygulandığı yer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kendi surface'i üzerinde body metni      | 4.5:1                                    | `app/globals.contrast.test.ts`: §3'teki her metin token'ı altı gerçek surface'e karşı (canvas, column, kart, popover, hover adımı, signature tint); boundary token'ları aynı altısını 3:1'de tutar. Hiçbir şey prose ile geçmez: her muafiyet, o dosyada ölçülen sayısını ve gerekçesini taşıyan adlandırılmış bir kayıttır, her run'da yeniden ölçülür ve o sayıdan saparsa ya da artık gerekmiyorsa gate'i kırar. Dört sınıfı var. `--border`, state taşımayan dekoratif hairline. signature tint üzerinde bakır metin (§3 bunu zaten yasaklar) ve hover adımı üzerinde bakır metin (hiçbir call site onu çizmez), ikisi de yalnız açık temada. Nokta olarak ölçülen ve yanındaki isimle relief alan dört açık tema label slot'u (§8). Ve tam güçteki ikizi gerçek mark olan alpha türevleri: inaktif bir control üzerinde `opacity-50` (WCAG onu muaf tutar, gate yine de 3:1'e tutar) ve sürüklenen bir kartın column'da bıraktığı boşluk. |
| Büyük metin (≥18.66px bold / 24px)       | 3:1                                      | Title'lar, hero figure'lar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Component sınırları ve state'leri        | 3:1                                      | Input border'ları, focus ring, sancak rail'i, chart mark'ları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Disabled metin                           | muaf, yine de 3:1'e tutulur              | Placeholder'lar, disabled control'ler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Chart surface'i üzerinde chart mark'ları | 3:1, ya da direct label'lar / table view | Açık slot 2, 3, 4, 5 relief route'unu alır (§8 dördünü de signature tint üzerinde nokta olarak 3:1'in altında ölçer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

| Kural                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Klavye paritesi              | Her pointer etkileşiminin bir klavye yolu vardır, drag and drop dahil (§5). Bir feature yalnızca drag ile yapılabiliyorsa, bitmemiş demektir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Renk asla tek başına değil   | priority ve status bir ikon ve bir kelimeyle ship edilir; label'lar isimlerini chip'te taşır; series'ler bir legend alır ve ≤4 series'te direct label alır; rail'e `aria-current` ve bir weight değişimi eşlik eder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Focus yönetimi               | Non-modal panel, açılışta focus'u kendi heading'ine taşır ve kapanışta onu originating card'a geri döndürür, trap etmeden. Dialog'lar _gerçekten_ trap eder, kapanışta focus'u restore eder ve `Esc`'te kapanır; popover'lar focus'u trigger'larına geri döndürür.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Menü içinde focus            | Radix, bir dropdown açılırken focus'u content'e, pointer hareket ettikçe de row'a taşır ve row'larda outline bastırıcı yok; bu yüzden pointer'ın altındaki row, `bg-accent` adımının üstünde, arrow ile gelinen row ile aynı tek focus outline'ını giyer. Bilerek böyle: alternatifi, klavyenin arrow key ile ulaştığı tek row türünde outline'ı yeniden bastırmak. Pointer için bir işaret fazla kabul edilir; klavye için bir işaret eksik kabul edilmez. Çalışan uygulamada Chromium 151 ve Firefox 153'te ölçüldü.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Announcement'lar             | Drag transition'ları, optimistic failure'lar, realtime arrival'lar ve toast'lar `aria-live="polite"` üzerinden geçer; yalnızca session'ı bitiren bir error `assertive`'dir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reduced motion               | Her yerde respect edilir ve bir state değişimini asla kaldırmaz: state yine değişir, yalnızca hareket etmeyi bırakır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Structure                    | Route başına bir `h1`; sidebar, main, panel için landmark; labelled composite widget olarak board; text olarak expose edilen column count'ları, infer edilmeyen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Zoom, reflow, forced colors  | 200%'de kullanılabilir: board iki yönde scroll olmak yerine sidebar collapse olur ve panel bir sheet'e dönüşür. `forced-colors: active`, border'ları ve focus ring'leri korur; chart'lar table view'a fallback eder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Forced colors, high contrast | Bir surface adımı veya bir tint üzerine kurulu her state, adı konmuş tek bir istisna dışında border tabanlı bir ikizini taşır. `forced-colors: active` altında: seçili kart bir `Highlight` outline alır, başka bir üyenin az önce değiştirdiği kart noktalı (dotted) bir `Highlight` border alır (seçimin solid border'ından ayrı okunsun diye noktalı), column'un drop target'ı kendi tint'i yerine inset bir `Highlight` outline alır, ve highlighted bir menü satırı kendi tint'i yerine `Highlight` / `HighlightText` boyar. İstisna, kartın hover adımıdır: forced colors `--border` ile `--border-strong`'u tek bir `CanvasText`'e indirir, dolayısıyla ikizi `Highlight`'ı ödünç almak zorunda kalır ve seçim gibi okunur; ayrıca hover, kaybedecek bir klavye yolu olmayan tek state'tir ve focus kendi ring'ini korur. `prefers-contrast: more` altında: `--border`, ikinci bir palet açmak yerine `--border-strong`'un değerini alır. |
| `--input` takma adı          | `--input`, `--border-strong`'un değerini okur (`app/globals.css`'te `--input: var(--border-strong)`), böylece `border-input` taşıyan her field, select ve textarea kendi token'ı olmadan zaten 3:1 boundary tabanını geçer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dark:` binding'i            | Tailwind'in `dark:` variant'ı, next-themes'in yazdığı `.dark` class'ına bağlıdır (`app/globals.css`'te `@custom-variant dark (&:where(.dark, .dark *))`), `prefers-color-scheme`'e değil; kullanıcının seçtiği tema, OS ayarından bağımsız olarak `components/ui/` içindeki her `dark:` utility'sini kontrol eder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 10. Çapraz referanslar

| Doküman                                                                | Burada neyi bağlıyor                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [coding-standards.md](coding-standards.md#nextjs-appsweb)              | `components/ui/` yalnızca shadcn output'udur: token'lar theme'de edit edilir, asla bir primitive'de değil; component'lerde, sabitlenmiş iki istisna dışında, arbitrary hex yok; conditional class'lar `cn()` üzerinden |
| [architecture.md](architecture.md#4-appsweb--yapı)                     | Bu dokümanın ortaya koyduğu `(auth)` / `(app)` route group'ları ve `board/`, `task/`, `dashboard/`, `layout/` component domain'leri                                                                                    |
| [api-conventions.md](api-conventions.md#hatalar)                       | Error metninin türediği problem-JSON şekli, ve `statusCode` üzerinden branch'leme kuralı                                                                                                                               |
| [Sevkedilen MVP özeti](../../ROADMAP.md#shipped-mvp-summary)           | Faz 3 token'ları, shell'i ve board chrome'unu getirir; Faz 4 drag etkileşimini ve detay panelini; Faz 5 priority ve label render'ını; Faz 7 grafikleri                                                                 |
| [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md) | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts: yukarıdaki her kuralın karşısında yazıldığı toolkit                                                                                                           |
| [tech-stack.md](tech-stack.md)                                         | Neden o toolkit                                                                                                                                                                                                        |
