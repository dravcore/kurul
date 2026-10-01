# 0036. Dokümantasyon Yalnız Türkçe

**Durum:** Kabul edildi
**Tarih:** 2026-10-01

## Bağlam

Dokümantasyon iki dilde tutuluyordu. `docs/README.md`'deki dil politikası İngilizceyi kanonik
sayıyordu: Türkçe, aynı dosya adlarıyla `docs/tr/` altında yaşıyor, kökte `README.md` ile
`README.tr.md` yan yana duruyordu ve EN ile TR çeliştiğinde önce EN düzeltiliyordu. `CLAUDE.md`'nin
doküman politikası bunu bir kurala bağlıyordu: `docs/` altında bir dosyayı değiştiren PR, `docs/tr/`
aynasını da aynı PR'da güncelliyordu. `CONTRIBUTING.md` ve PR şablonu aynı kuralı taşıyordu.

2026-10-01'de yapılan ölçümde (`develop` dalında `827754d`) 47 dosya çifti vardı: 9 kılavuz,
`docs/README.md`, 35 ADR ile ADR dizini ve kök README. İngilizce taraf yaklaşık 1,07 milyon, Türkçe
taraf yaklaşık 1,12 milyon karakterdi. Her doküman değişikliği iki kez yazılıyordu.

Ayna kayması da gerçekti. İki tarafın başlık ağaçları birebir aynıydı (518 başlık), ama bölüm bölüm
karşılaştırmada 114 bölüm işaretlendi: 109'unda dilden bağımsız öğelerde (kod span'leri, sayılar, kod
blokları, bağlantı hedefleri, liste öğesi ve blok sayıları) fark vardı, 5'inde yalnız metin uzunluğu
oranı bayrak almıştı. Farkların bir kısmı çevrilmiş kod yorumu ve sayı biçimi gibi zararsız farklardı,
bir kısmı gerçek kaymaydı. Üç örnek:

- [`docs/api-conventions.md`](../api-conventions.md): Türkçe sürümde "CRUD olmayan aksiyonlar" rota
  bloğunda üç rota yoktu (task'tan assignee kaldırma, task'a label ekleme ve task'tan label
  çıkarma). Filtreleme tablosunun `Sıralama` ve `Çoklu sıralama` satırları ise eskimişti: henüz
  hiçbir liste endpoint'i `sort` kabul etmediği hâlde `?sort=-createdAt` ve
  `?sort=priority,-dueDate` örneklerini veriyordu; İngilizce asıl bunu "ayrılmış konvansiyon" diye
  anlatıyordu.
- [ADR 0002](0002-backend-stack.md): Türkçe gövdedeki "Postgres + Redis" gerekçesinin son cümlesi
  eski hâliyle kalmıştı ve Redis'in dört işi karşıladığını söylüyordu (bildirim kuyruğu, session
  store, rate limiting, Socket.io adapter'ı). İngilizce asıldaki güncel cümle yalnız Socket.io
  adapter'ını ve BullMQ kuyruğunu sayıyor, session'ların PostgreSQL'de yaşadığını söylüyordu.
  2026-08-18 tarihli `Güncellendi` notunun alıntıladığı "HTTP rate limiting henüz bağlanmadı"
  ifadesi de Türkçe gövdede hiç geçmiyordu.
- [ADR 0011](0011-label-task-metadata-permissions.md): Türkçe "Sonuçlar" listesinde bir madde
  düşmüştü: assignee'lerin workspace üyesi olması, label'ların task'ın board'una ait olması.

[ADR 0015](0015-no-external-contributions.md) Sonuçlar'da bu yükü daha önce kayda geçirmişti:
"Çeviri katkıları kapalı olduğu için `docs/tr/` altındaki Türkçe ayna, güncel tutulması sahibin
kendi işi olan bir yük olmaya devam ediyor."

## Karar

**İngilizce dokümantasyon tamamen kalkıyor; dokümantasyon Türkçe sürüyor.** İki dili birlikte
taşımak masraflı. Bu karar yalnız dokümantasyon içindir: üründe İngilizce kalıyor. Dil politikasının
güncel hâli [docs/README.md](../README.md#dil-politikası) içinde.

**Türkçe olanlar:**

- `docs/**` (kılavuzlar ve bütün ADR'ler) ile kök `README.md`.
- Yaşayan kök dosyalar: `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `CLAUDE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/*` ve test fixture
  README'leri.
- `CHANGELOG.md`: `[Unreleased]` ve bundan sonraki sürümler Türkçe yazılıyor. Yayımlanmış
  sürümlerin kayıtlarının (`[0.4.1]` ve öncesi) metni İngilizce kalıyor ve çevrilmiyor; yalnız
  dokümanlara verilen bağlantıların ve atıfların hedefleri (taşınan yollar ve Türkçe başlık
  çapaları), bağlantılar kırılmasın diye güncellendi.

**İngilizce kalanlar:**

- Kod, kod yorumları, test adları, commit mesajları, dal adları ve PR başlıkları.
- API hata metinleri ve OpenAPI açıklaması (`apps/api/openapi.json`).
- Arayüz dilleri: `en` ve `tr` birlikte desteklenmeye devam ediyor
  ([ADR 0018](0018-localization-strategy.md) değişmedi).
- Dosya adları ve yolları: `docs/api-conventions.md` gibi adlar İngilizce kebab-case kalıyor.

**Uygulama:**

- İngilizce `docs/**` ve kök `README.md` silindi; Türkçe dosyalar aynı yollara taşındı
  (`docs/tr/<dosya>` → `docs/<dosya>`, `README.tr.md` → `README.md`). Yollar değişmediği için
  koddan, CI'dan ve yorumlardan verilen `docs/...` atıfları çözülmeye devam ediyor.
- Silinen İngilizce metin git geçmişinde duruyor; son hâli `develop` dalındaki `827754d`
  commit'inde, yayımlanmış sürümün hâli `v0.4.1` etiketinde.
- Aynı değişiklikte her Türkçe dosya, silinen İngilizce aslıyla bölüm bölüm karşılaştırıldı ve
  Türkçede eksik ya da eskimiş kalan yerler tamamlandı; ardından bağımsız bir ikinci okuma bunu
  örneklemle doğruladı.
- Depodaki `docs/<dosya>.md#<çapa>` atıfları Türkçe başlık çapalarına çevrildi (kod yorumları,
  compose dosyaları, `.env.example`, betiklerin yazdırdığı mesajlar, OpenAPI açıklaması).

## Gerekçe

- **Sebep masraf.** İki dili birlikte taşımak masraflı: her doküman değişikliği iki kez yazılıyordu
  ve iki taraf birbirinden kayıyordu. İngilizceyi kaldırmak bu masrafı ortadan kaldırıyor; iki dili
  sürdürmek onu olduğu gibi bırakırdı.
- **Dil, sahibinin seçimi.** Sahibi dokümantasyonu Türkçe sürdürmeyi seçti.
- **Yollar aynı kaldı.** Türkçe dosyalar İngilizce asılların yollarına taşındığı için `docs/...`
  atıfları ve GitHub depo sayfasında gösterilen kök `README.md` yerinde duruyor.

## Sonuçlar

- **Bir doküman değişikliği artık tek dosyada yapılır.** "Ayna aynı PR'da güncellenir" kuralı
  kalktı.
- **Türkçe bilmeyen bir okur (operatör ya da katkıcı) için kılavuzlar doğrudan okunamaz.** Arayüz
  ve OpenAPI belgesi İngilizce olarak kullanılabilir kalır.
- **Çapalar Türkçe karakter taşır** (`#kimlik-doğrulama`), çünkü başlıklar Türkçe. Bir başlığı
  değiştiren PR, o çapaya verilen bağlantıları da günceller; bunların bir kısmı kod yorumlarında ve
  compose dosyalarındadır.
- **`v0.4.1` ve öncesi için yayımlanmış GitHub Release notları İngilizcedir ve öyle kalır.**
  Sonraki sürümlerin notu CHANGELOG'un Türkçe bölümünden gelir.
- **Web arayüzünden ve OpenAPI açıklamasından verilen doküman bağlantıları** artık Türkçe sayfaya
  gider.

## Değerlendirilen Alternatifler

| Alternatif                                                    | Neden değil                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| İki dili sürdürmek                                            | Masraf aynen kalırdı; kararın sebebi bu                                                                                                               |
| İngilizceyi tutup Türkçeyi bırakmak                           | Sahibi dokümantasyonu Türkçe sürdürmeyi seçti                                                                                                         |
| Türkçeyi `docs/tr/` altında bırakıp yalnız İngilizceyi silmek | `docs/` dışında `docs/...` yolunu anan 180'den fazla dosyadaki atıflar kırılırdı; kök `README.md` olmadan GitHub depo sayfasında README gösterilmezdi |

## Etkilenen Kayıtlar

İki dilli düzene değinen dokuz eski ADR'de bu ifadeler olduğu gibi bırakıldı; her birinin başına,
aynı kalıpla yazılmış ve bu ADR'ye bağlanan bir `**Güncellendi:** 2026-10-01` notu düşüldü:

- [ADR 0015](0015-no-external-contributions.md): Sonuçlar'daki "`docs/tr/` altındaki Türkçe ayna"
  ifadesi kaldırılan düzene ait; anılan dokümanların artık tek bir kopyası var.
- [ADR 0018](0018-localization-strategy.md) (yerelleştirme stratejisi): Bağlam'daki "İngilizce
  kanonik + `docs/tr` aynası" ve Sonuçlar'daki "`docs/tr/**` içinde ise İngilizce kalır" ifadeleri
  kaldırılan düzene ait; rol adlarının dokümanda İngilizce kalması kuralı `docs/**` için sürüyor.
  Ürün yerelleştirme kararı (arayüzde `en` ve `tr`, `messages/en.json` kanonik) değişmedi.
- [ADR 0022](0022-attachment-storage.md), [ADR 0024](0024-attachment-kinds-and-serving-policy.md),
  [ADR 0027](0027-attachment-quotas.md) ve [ADR 0032](0032-plan-limits.md): Sonuçlar'daki Türkçe
  aynaya ya da Türkçe kopyaya değinen ifadeler (örneğin "Türkçe aynaları aynı PR'da taşınır")
  kaldırılan düzene ait; anılan dokümanların artık tek bir kopyası var.
- [ADR 0028](0028-open-contributions-hosted-service.md): Sonuçlar'daki "iki README" ifadesi
  kaldırılan düzene ait; anılan dokümanların artık tek bir kopyası var. Doküman katkıları sürüyor ve
  artık Türkçe yazılıyor; arayüz dil kataloglarına çeviri katkıları bundan etkilenmiyor.
- [ADR 0033](0033-webhook-delivery-and-failure-policy.md) ve
  [ADR 0034](0034-hosted-billing-and-plan-assignment.md): Sonuçlar'daki "Türkçe aynası"
  ifadeleri de kaldırılan düzene ait. Bu iki ADR henüz Önerildi durumunda; o maddeler geçmişte
  yapılmış bir işi değil, uygulandıklarında yapılacak işi anlatıyor ve uygulanırken tek dosyaya
  göre okunur.

Düzeni anlatan canlı dokümanlar yeni duruma göre yeniden yazıldı: `docs/README.md`'nin
[Dil politikası](../README.md#dil-politikası) bölümü, [`CLAUDE.md`](../../CLAUDE.md)'nin
dokümantasyon ve doküman politikası bölümleri, `CONTRIBUTING.md` ve PR şablonu.
