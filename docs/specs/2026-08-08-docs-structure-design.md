# Kurultay Dokümantasyon Yapısı — Tasarım Spec'i

**Tarih:** 2026-08-08
**Durum:** Onaylandı (kullanıcı ile Q&A sonucu)
**Kapsam:** Proje standardında tam docs seti kurulumu; mevcut root MD'lerin taşınması ve standartlaştırılması

---

## 1. Amaç

Kurultay (açık kaynak Kanban proje yönetim aracı, dravcore/kurultay, AGPL-3.0) henüz iskelet
öncesi aşamada. Kod yazılmaya başlamadan önce projenin tüm standartlarını tanımlayan,
tutarlı formatta, iki dilli bir dokümantasyon yapısı kurulacak. Root'taki mevcut
`tech-stack.md` ve `project-skeleton.md` bu yapıya taşınacak ve aynı standarda
güncellenecek.

## 2. Alınan Kararlar (Q&A sonucu)

| Konu | Karar |
|---|---|
| Dil stratejisi | Tam lokalizasyon: EN kanonik, `docs/tr/` altında tam TR kopya |
| Git stratejisi | Git Flow (`main` + `develop` + `feature/*` + `release/*` + `hotfix/*`) |
| Karar kaydı | Hafif ADR — `docs/decisions/` altında numaralı MADR-benzeri dosyalar |
| İlerleme | `docs/roadmap.md` (yüksek seviye fazlar) + GitHub Issues (görev takibi) |
| Commit | Conventional Commits |
| Versiyon | SemVer + `CHANGELOG.md` (Keep a Changelog formatı) |
| Ek docs | Kod standartları, test stratejisi, API konvansiyonları, SECURITY.md + issue şablonları |
| Araştırma | Büyük OSS PM araçları (Plane, Cal.com, Supabase, Novu) + kullanıcının kendi GitHub repoları |

## 3. Hedef Dosya Yapısı

```
/  (kök — GitHub'ın özel muamele ettiği dosyalar)
├── README.md            # EN kanonik
├── README.tr.md         # TR çeviri (karşılıklı dil linkleri)
├── CONTRIBUTING.md      # kurulum + katkı süreci (git-strategy.md'ye link)
├── CODE_OF_CONDUCT.md   # Contributor Covenant v2.1
├── SECURITY.md          # güvenlik bildirim politikası
├── CHANGELOG.md         # Keep a Changelog + SemVer (Unreleased ile başlar)
├── CLAUDE.md            # kökte kalır (docs/ referansları güncellenir)
├── LICENSE              # AGPL-3.0 (mevcut)
├── .github/
│   ├── ISSUE_TEMPLATE/  # bug_report, feature_request (form YAML)
│   └── PULL_REQUEST_TEMPLATE.md
└── docs/
    ├── architecture.md      # modüler monolit, modül haritası, veri modeli özeti
    ├── tech-stack.md        # mevcut dosyadan EN'e evrilir, standarda uyarlanır
    ├── project-skeleton.md  # mevcut dosyadan EN'e evrilir, standarda uyarlanır
    ├── development.md       # ortam kurulumu, günlük workflow, komutlar
    ├── coding-standards.md  # TS/NestJS/Next.js konvansiyonları
    ├── git-strategy.md      # Git Flow + Conventional Commits + release süreci
    ├── testing.md           # test katmanları + araçlar + beklentiler
    ├── api-conventions.md   # REST adlandırma, hata formatı, pagination, DTO
    ├── roadmap.md           # fazlar + checklist, GitHub Issues linki
    ├── decisions/
    │   ├── README.md        # ADR indeksi + şablon
    │   ├── 0001-monorepo-modular-monolith.md
    │   ├── 0002-backend-stack.md        # NestJS + Prisma + PostgreSQL + Redis
    │   ├── 0003-frontend-stack.md       # Next.js + Tailwind + shadcn/ui + Recharts
    │   ├── 0004-auth-better-auth.md
    │   ├── 0005-realtime-socketio.md
    │   ├── 0006-fractional-indexing.md
    │   ├── 0007-license-agpl.md
    │   └── 0008-git-flow-semver.md
    └── tr/                  # docs/ altındaki her dosyanın TR kopyası (aynı ad)
```

## 4. MD Standardı (tüm dosyalara uygulanır)

### 4.0 Adlandırma standardı (sektör pratiği)

- **Kök topluluk dosyaları BÜYÜK HARF:** `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE` — GitHub bu adları
  özel tanır (Community Standards, sekmeler)
- **`docs/` altı küçük-harf-kebab-case:** `git-strategy.md`, `coding-standards.md` —
  URL dostu, case-sensitive dosya sistemlerinde güvenli
- **ADR'ler `NNNN-kebab-başlık.md`:** 4 haneli sıfır dolgulu numara (MADR standardı)
- **Çeviriler:** kökte `README.tr.md`, docs'ta `docs/tr/<aynı-dosya-adı>.md`
  (ISO 639-1 küçük harf dil kodu)
- Dosya adlarında boşluk, Türkçe karakter ve büyük harf (kök topluluk dosyaları hariç) yok

### 4.1 Dosya içi şablon

Her doc dosyası şu şablona uyar — mevcut iki MD de bu standarda **güncellenir**:

1. `# Başlık` (H1, tek satır)
2. Hemen altında bir satırlık amaç cümlesi
3. Dil satırı: `> 🌐 English (canonical) | `[Türkçe](tr/<dosya>.md)`` (TR kopyada tersi +
   "çeviri güncel olmayabilir, kanonik kaynak İngilizce" notu)
4. Uzun docs'larda (100+ satır) içindekiler bölümü
5. Başlık hiyerarşisi `##`/`###`, tablo ve kod bloğu tercih edilir, süslü prose değil
6. Dosya içi çapraz referanslar göreli link ile (``[git-strategy](git-strategy.md)``)
7. ADR'ler MADR-lite: Başlık, Durum, Tarih, Bağlam, Karar, Gerekçe, Sonuçlar

## 5. Mevcut Dosyaların Akıbeti

| Dosya | İşlem |
|---|---|
| `tech-stack.md` | `docs/tech-stack.md`'ye taşınır, EN'e çevrilir, standarda uyarlanır; TR orijinali güncellenerek `docs/tr/tech-stack.md` olur; karar gerekçeleri ADR 0001–0007'ye damıtılır (özet + ADR linki docs'ta kalır) |
| `project-skeleton.md` | `docs/project-skeleton.md`'ye taşınır, EN'e çevrilir, standarda uyarlanır; TR orijinali güncellenerek `docs/tr/project-skeleton.md` olur |
| `CLAUDE.md` | Kökte kalır; docs referansları yeni yapıya göre güncellenir (kritik kurallar korunur) |

Taşımalar `git mv` ile yapılır (tarihçe korunur).

## 6. Git Süreci (bu işin kendisi için)

- `develop` branch'i `main`'den açıldı; iş `feature/docs-structure` üzerinde yürür
- Commit'ler Conventional Commits: `docs: ...` önekiyle, mantıklı parçalara bölünmüş
- İş bitince `feature/docs-structure` → `develop` merge edilir (ilk Git Flow döngüsü)

## 7. Uygulama Süreci (subagent planı)

1. **Araştırma (paralel, arka plan, Sonnet):**
   - Agent A: Plane, Cal.com, Supabase, Novu repolarının docs yapısı, CONTRIBUTING,
     `.github` şablonları, lokalizasyon desenleri → rapor
   - Agent B: kullanıcının (dogancanyildiz) ve dravcore org'un GitHub repolarındaki
     doc desenleri → rapor
2. **Yazım:** Raporlar ışığında EN docs'lar subagent'lara bölüştürülerek yazdırılır
   (mantıksal gruplar: [governance dosyaları], [mimari+stack], [süreç docs'ları], [ADR seti])
3. **TR geçişi:** Tüm EN docs'ların TR kopyaları `docs/tr/` altına üretilir
4. **Final:** Tutarlılık kontrolü (çapraz linkler, terim birliği, standart uyumu),
   CLAUDE.md güncellemesi, commit'ler

## 8. Kapsam Dışı (YAGNI)

- Docs sitesi (Docusaurus/Mintlify vb.) — MD dosyaları yeterli, ileride değerlendirilir
- CI workflow dosyaları (`.github/workflows/`) — iskelet kurulumunun konusu, bu işin değil
- API referans üretimi (OpenAPI/Swagger) — kod olmadan üretilemez
- `docs/tr/` dışında başka dil — talep gelirse eklenir

## 9. Başarı Kriteri

- Yukarıdaki ağaçtaki tüm dosyalar mevcut, MD standardına uygun ve çapraz linkleri çalışıyor
- `docs/tr/` EN seti ile birebir eşleşiyor
- Root'ta yalnızca GitHub-standart dosyalar + CLAUDE.md kalıyor
- Mevcut iki MD'nin içeriği kaybolmadan yeni yapıya damıtılmış durumda
