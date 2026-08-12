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

Kurultay’ın MVP özellik seti tamamlandı; test stratejisi bilinçli olarak **kapsamlı değil,
pragmatik** kalır:

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

| Katman          | Araç                                   | Kapsam                                                                                               | Durum                                                             |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Unit**        | Jest (`apps/api`), Vitest (`apps/web`) | Servisler, guard'lar, saf fonksiyonlar, board/izin logic'i, DnD hook'ları. Bağımlılıklar mock'lanır. | Baştan itibaren zorunlu                                           |
| **Integration** | Jest + Supertest                       | HTTP request → controller → service → **gerçek Postgres** (`docker-compose.dev.yml` üzerinden)       | Her endpoint için zorunlu                                         |
| **E2E**         | Playwright                             | Tam stack üzerinde browser akışları                                                                  | **MVP'de kurulu değil** — ileride kritik akışlar için ayrılmıştır |

```
        /\        e2e — ertelendi (Playwright)
       /  \
      /────\      integration — her endpoint (Supertest + gerçek Postgres)
     /      \
    /────────\    unit — servisler, guard'lar, saf logic (Jest), web logic/hook'ları (Vitest)
```

Tam component-tree render testleri MVP'nin parçası değil. Web unit testleri saf logic'i
(`lib/*.test.ts` — izinler, position matematiği, mention'lar, query parametreleri) ve board
drag-and-drop hook'unu izole şekilde kapsar; geri kalan her şey için yapılan takas tip
güvenliği artı API'nin integration coverage'ı, ve board UI'ı oturduğunda onu daha fazla
component testi değil, uçtan uca Playwright kapsar.

## Neler test edilmeli

Bu üç alan pazarlığa açık değildir. Bunlara dokunan ama testsiz bir PR merge edilmez.

### 1. Fractional indexing (`Task.position`)

`Task.position` bir `Float`'tır ve tüm drag-and-drop sıralama modeli buna bağlıdır.
Kapsanması gereken durumlar:

| Durum                                         | Beklenti                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| İki kart arasına ekleme                       | Yeni position, komşuların kesin arasındadır                                          |
| Bir column'un en üstüne ekleme                | Position, mevcut ilkinden küçüktür                                                   |
| En alta ekleme                                | Position, mevcut sonuncudan büyüktür                                                 |
| Boş bir column'a ekleme                       | Geçerli bir başlangıç position'ı üretilir                                            |
| Aynı column içinde taşıma                     | Yalnızca taşınan satır güncellenir                                                   |
| Column'lar arası taşıma                       | Hem `columnId` hem `position` güncellenir; başka hiçbir satır değişmez               |
| Aynı boşluğa (gap) tekrarlanan eklemeler      | Float precision tükenmez; boşluk çok küçülürse column yeniden dengelenir (rebalance) |
| Aynı boşluğa eşzamanlı (concurrent) taşımalar | İki task aynı position'da bitmez, ya da çakışma deterministik olarak çözülür         |

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

| Tür                          | Konum                               | Desen                                                |
| ---------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Unit                         | Kaynak dosyayla yerinde (colocated) | `apps/api/src/task/task.service.spec.ts`             |
| Integration                  | Ayrı bir test kökü                  | `apps/api/test/task.e2e-spec.ts`                     |
| Test helper'ları/factory'ler | Test kökü altında paylaşılır        | `apps/api/test/helpers/`, `apps/api/test/factories/` |
| Playwright (ileride)         | Repository seviyesinde              | `e2e/`                                               |

Nest'in generator'ı integration testlerini `*.e2e-spec.ts` olarak adlandırıyor; bunlar
browser e2e değil API integration testleri olsa da bu isim tooling uyumluluğu için
korunuyor.

## Testleri çalıştırma

```bash
# Integration testler için servisler ayakta olmalı
docker compose -f docker-compose.dev.yml up -d

pnpm --filter @kurultay/api test          # api unit
pnpm --filter @kurultay/api test:watch    # api unit, watch modu
pnpm --filter @kurultay/api test:e2e      # integration (Postgres gerektirir)
pnpm --filter @kurultay/api test:cov      # api coverage raporu

pnpm --filter @kurultay/web test          # web unit (Vitest)
pnpm --filter @kurultay/web test:watch    # web unit, watch modu
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

**Coverage önce bir sinyaldir.** Repo genelinde bir hedef yoktur ve bir sayıyı kendisi için
yükseltme arzusu da yoktur.

- Raporu, hiçbir testin çalıştırmadığı kodu bulmak için kullanın, sonra o kodun bir test
  _hak edip etmediğine_ karar verin.
- Bir positioning algoritmasında düşük coverage bir problemdir. Bir DTO'da veya bir barrel
  dosyasında düşük coverage değildir.
- Assertion'sız testlerle bir eşiği kandırmak, eşiğin hiç olmamasından daha kötüdür. Bu
  yüzden taban değerler yalnızca zaten anlamlı biçimde test edilmiş koda uygulanır; bir
  ortalamayı yukarı çekmek için asla global olarak konmaz.

### Taban değerlerin bulunduğu yerler

Zaten kapsanmış kodun geri kaymasını mandallar engeller. Hepsi CI'ı kırar.

| Kapsam                            | Taban değer                                           | Nerede tanımlı              |
| --------------------------------- | ----------------------------------------------------- | --------------------------- |
| `apps/api` global                 | statements 55 / branches 45 / functions 57 / lines 56 | `apps/api/jest.config.cjs`  |
| `apps/web` `app/**`               | statements 85 / branches 90 / functions 85 / lines 85 | `apps/web/vitest.config.ts` |
| `apps/web` `components/board/**`  | statements 65 / branches 54 / functions 54 / lines 70 | `apps/web/vitest.config.ts` |
| `apps/web` `components/task/**`   | statements 60 / branches 60 / functions 58 / lines 62 | `apps/web/vitest.config.ts` |
| `apps/web` `components/layout/**` | statements 75 / branches 65 / functions 85 / lines 78 | `apps/web/vitest.config.ts` |

Hepsi konuldukları anda alınan ölçümün birkaç puan altındadır — rutin bir refactor'ın
takılmayacağı kadar pay bırakan, ama bir testin silinmesini yakalayacak kadar dar.

`apps/web`'in **global bir taban değeri yoktur**, bilinçli olarak. Genel web coverage son
koşularda instrumented satırların ~%75'i civarındadır ama bu ortalama hâlâ yoğun testli
hook'ları ince sayfa kabuklarıyla karıştırır; ortalamada bir global taban az şey yakalar.
Klasör tabanları anlamlı unit testleri olan yüzeyleri kapsar: route girişleri (`app/**`) ve
etkileşimli board / task / layout bileşenleri. `apps/web/vitest.config.ts` tam gerekçeyi
satır içinde taşır.

Global duruş, API'nin repo genelinde bir taban değerin anlamlı olacağı kadar kararlı olduğu
1.0'da yeniden gözden geçirilir.

Her iki suite de HTML/JSON raporlarını her koşuda — geçse de kalsa da — CI artifact'ı olarak
yayımlar (`api-coverage`, `web-coverage`).

## CI

Her pull request, `develop` ve `main` üzerinde de olduğu gibi şunları çalıştırır:

| Adım                | Komut                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Shared paket build  | `pnpm --filter @kurultay/shared-types build && pnpm --filter @kurultay/auth-access build` |
| Lint                | `pnpm lint`                                                                               |
| Format kontrolü     | `pnpm format:check`                                                                       |
| Typecheck           | `pnpm typecheck` (workspace'ler genelinde `tsc --noEmit`)                                 |
| Unit testler (api)  | `pnpm --filter @kurultay/api test:cov`                                                    |
| Unit testler (web)  | `pnpm --filter @kurultay/web exec vitest run --coverage`                                  |
| Integration testler | Postgres ve Redis service container'larına karşı `pnpm --filter @kurultay/api test:e2e`   |
| Build               | `pnpm build`                                                                              |

Merge öncesi tüm adımlar geçmelidir. Bkz.
[git-strategy.md](git-strategy.md#pull-request-süreci).

Workflow dosyası: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Ayrıca bakınız

- [development.md](development.md) — servisleri yerelde çalıştırma
- [coding-standards.md](coding-standards.md) — testlerin varsaydığı kod konvansiyonları
- [api-conventions.md](api-conventions.md) — assert edilecek status kodları ve hata şekilleri
- [git-strategy.md](git-strategy.md) — PR gereksinimleri
- [roadmap.md](roadmap.md) — MVP durumu ve Beyond MVP (Playwright e2e hâlâ erteli)
