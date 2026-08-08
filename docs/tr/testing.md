# Test

Kurultay'ın neyi, hangi araçlarla test ettiği ve CI'ın neyi zorunlu kıldığı.

> 🌐 [English (canonical)](../testing.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Strateji](#strateji)
- [Piramit](#piramit)
- [Neler test edilmeli](#neler-test-edilmeli)
- [Dosya konvansiyonları](#dosya-konvansiyonları)
- [Testleri çalıştırma](#testleri-çalıştırma)
- [Test yazma](#test-yazma)
- [Coverage](#coverage)
- [CI](#ci)

## Strateji

Kurultay MVP öncesi. Test stratejisi bilinçli olarak **kapsamlı değil, pragmatik**:

- **Doğru yapması zor** ve **yanlış yapması pahalı** olan mantığı test edin — sıralama,
  tenant izolasyonu, auth.
- API'yi mock'lanmış bir Prisma client'a karşı değil, **gerçek bir PostgreSQL'e karşı**
  test edin. Bu aşamada yakalanmaya değer çoğu bug TypeScript'te değil, sorguda yaşıyor.
- Bir coverage sayısının peşinden **koşmayın**. Yalnızca implementasyonu yeniden ifade eden
  testler yazmayın.
- Browser e2e, UI haftalık şekil değiştirmeyi bırakana kadar ertelenir.

Bir testin maliyeti onu yazmak değildir — her refactor boyunca onu bakımda tutmaktır.
Testler, bu maliyetin gerçek güven satın aldığı yerlerde yazılır.

## Piramit

| Katman | Araç | Kapsam | Durum |
|---|---|---|---|
| **Unit** | Jest (NestJS varsayılanı) | Servisler, guard'lar, saf fonksiyonlar. Bağımlılıklar mock'lanır. | Baştan itibaren zorunlu |
| **Integration** | Jest + Supertest | HTTP request → controller → service → **gerçek Postgres** (`docker-compose.dev.yml` üzerinden) | Her endpoint için zorunlu |
| **E2E** | Playwright | Tam stack üzerinde browser akışları | **MVP'de kurulu değil** — ileride kritik akışlar için ayrılmıştır |

```
        /\        e2e — ertelendi (Playwright)
       /  \
      /────\      integration — her endpoint (Supertest + gerçek Postgres)
     /      \
    /────────\    unit — servisler, guard'lar, saf logic (Jest)
```

Frontend component testleri de MVP'nin parçası değil. Yapılan takas, tip güvenliği artı
API'nin integration coverage'ı; board UI'ı oturduğunda, onu parçalar halinde component
testleri değil, uçtan uca Playwright kapsar.

## Neler test edilmeli

Bu üç alan pazarlığa açık değildir. Bunlara dokunan ama testsiz bir PR merge edilmez.

### 1. Fractional indexing (`Task.position`)

`Task.position` bir `Float`'tır ve tüm drag-and-drop sıralama modeli buna bağlıdır.
Kapsanması gereken durumlar:

| Durum | Beklenti |
|---|---|
| İki kart arasına ekleme | Yeni position, komşuların kesin arasındadır |
| Bir column'un en üstüne ekleme | Position, mevcut ilkinden küçüktür |
| En alta ekleme | Position, mevcut sonuncudan büyüktür |
| Boş bir column'a ekleme | Geçerli bir başlangıç position'ı üretilir |
| Aynı column içinde taşıma | Yalnızca taşınan satır güncellenir |
| Column'lar arası taşıma | Hem `columnId` hem `position` güncellenir; başka hiçbir satır değişmez |
| Aynı boşluğa (gap) tekrarlanan eklemeler | Float precision tükenmez; boşluk çok küçülürse column yeniden dengelenir (rebalance) |
| Aynı boşluğa eşzamanlı (concurrent) taşımalar | İki task aynı position'da bitmez, ya da çakışma deterministik olarak çözülür |

Precision tükenmesi ve concurrency durumları production'da gerçekten kırılan durumlardır.
Bunları ima yoluyla değil, açıkça test edin.

### 2. Workspace izolasyonu

Her sorgu `workspaceId` ile scope'lanır. Bu multi-tenancy garantisi ve bir güvenlik
sınırıdır, dolayısıyla öyle test edilir:

- Workspace A'nın bir üyesinin bir workspace B kaynağı isteği **404** alır (403 değil —
  kaynağın var olduğunu doğrulamayın).
- İç içe route'lar tüm zinciri doğrular: bir task, URL'deki workspace'e ait bir board'a ait
  olmalıdır.
- Liste endpoint'leri, bir filtre veya arama terimi onlarla eşleşse bile başka bir
  workspace'ten satır asla döndürmez.
- Rol kontrolleri: `OWNER`/`ADMIN`/`MEMBER`/`GUEST`'in her biri en az bir izin verilen ve
  bir reddedilen durumu hit eder.

İzolasyon kuralı tip sistemi yerine bir guard tarafından zorlandığından, bu testler onun
tek mekanik zorlaması olur.

### 3. Auth akışları

- Kayıt, giriş, çıkış, session yenileme
- Korunan bir route'a kimliksiz istek → **401**
- Süresi dolmuş veya kurcalanmış session → **401**
- Davet kabulü, tam olarak amaçlanan rolü verir

## Dosya konvansiyonları

| Tür | Konum | Desen |
|---|---|---|
| Unit | Kaynak dosyayla yerinde (colocated) | `apps/api/src/task/task.service.spec.ts` |
| Integration | Ayrı bir test kökü | `apps/api/test/task.e2e-spec.ts` |
| Test helper'ları/factory'ler | Test kökü altında paylaşılır | `apps/api/test/helpers/`, `apps/api/test/factories/` |
| Playwright (ileride) | Repository seviyesinde | `e2e/` |

Nest'in generator'ı integration testlerini `*.e2e-spec.ts` olarak adlandırıyor; bunlar
browser e2e değil API integration testleri olsa da bu isim tooling uyumluluğu için
korunuyor.

## Testleri çalıştırma

```bash
# Integration testler için servisler ayakta olmalı
docker compose -f docker-compose.dev.yml up -d

pnpm --filter @kurultay/api test          # unit
pnpm --filter @kurultay/api test:watch    # unit, watch modu
pnpm --filter @kurultay/api test:e2e      # integration (Postgres gerektirir)
pnpm --filter @kurultay/api test:cov      # coverage raporu
```

Integration testler, test setup'ı tarafından oluşturulan ve migrate edilen **ayrı bir
veritabanına** (`kurultay_test`) karşı çalışır. Geliştirme veritabanına asla dokunmazlar.

## Test yazma

- **Arrange–Act–Assert**, üç kısım arasında boş satırlarla.
- Test isimleri metot isimlerini değil davranışı tarif eder:
  `it('returns 404 when the board belongs to another workspace')`, `it('findOne works')`
  değil.
- Test başına bir davranış. İsim "ve" gerektiriyorsa, bölün.
- Entity'ler için factory/builder kullanın; aynı 15 alanlı task literal'ini yirmi testte
  elle yazmayın.
- **Her integration testi kendinden sonra temizlik yapar** — etkilenen tabloları
  `afterEach`'te truncate edin ya da testi geri alınan (rolled back) bir transaction
  içine sarın. Sıraya bağımlı test suite'leri bir bug'dır.
- Yalnızca kontrol etmediğiniz bir process sınırını geçen şeyleri mock'layın (email,
  üçüncü parti HTTP). Integration testlerinde Prisma'yı mock'lamayın — onların amacı tam
  olarak bu.
- `setTimeout` tabanlı bekleme yok. Şeyin kendisini await edin.
- Bir bug fix'i, fix'ten önce başarısız olan bir regresyon testiyle birlikte gelir.

## Coverage

**Coverage bir sinyaldir, bir kapı değil.** Minimum bir yüzde yoktur ve CI coverage
üzerinden başarısız olmaz.

- Raporu, hiçbir testin çalıştırmadığı kodu bulmak için kullanın, sonra o kodun bir test
  *hak edip etmediğine* karar verin.
- Bir positioning algoritmasında düşük coverage bir problemdir. Bir DTO'da veya bir barrel
  dosyasında düşük coverage değildir.
- Assertion'sız testlerle bir eşiği kandırmak, eşiğin hiç olmamasından daha kötüdür — bir
  eşiğin olmamasının tam sebebi de budur.

Bu duruş, API'nin bir taban değerin anlamlı olacağı kadar kararlı olduğu 1.0'da yeniden
gözden geçirilir.

## CI

Her pull request, `develop` ve `main` üzerinde de olduğu gibi şunları çalıştırır:

| Adım | Komut |
|---|---|
| Lint | `pnpm lint` |
| Typecheck | Workspace'ler genelinde `tsc --noEmit` |
| Unit testler | `pnpm --filter @kurultay/api test` |
| Integration testler | Bir Postgres service container'ına karşı `pnpm --filter @kurultay/api test:e2e` |
| Build | `pnpm build` |

Merge öncesi tüm adımlar geçmelidir. Bkz.
[git-strategy.md](git-strategy.md#pull-request-süreci).

Workflow dosyası: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Ayrıca bakınız

- [development.md](development.md) — servisleri yerelde çalıştırma
- [coding-standards.md](coding-standards.md) — testlerin varsaydığı kod konvansiyonları
- [api-conventions.md](api-conventions.md) — assert edilecek status kodları ve hata şekilleri
- [git-strategy.md](git-strategy.md) — PR gereksinimleri
- [roadmap.md](roadmap.md) — CI ve e2e'nin ne zaman geleceği
