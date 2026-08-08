# 0004. Auth: Organization Plugin ile Better Auth

**Durum:** Kabul edildi
**Tarih:** 2026-08-08
**Güncellendi:** 2026-08-08 — topluluk bakımlı NestJS entegrasyonunun ve Better Auth'un 2.0 öncesi sürüm temposunun taşıdığı entegrasyon riskini ekler.

> 🌐 [English (canonical)](../../decisions/0004-auth-better-auth.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Çok kiracılı workspace'ler ürünün merkezinde — her kullanıcı rolleri ve davetleriyle bir veya daha fazla workspace'e ait — dolayısıyla auth seçimi, ne kadar çok kiracılılık mantığının sıfırdan elle inşa edilmesi gerekeceğini, ne kadarının yeniden kullanılabileceğini belirliyor.

## Karar

Auth.js/NextAuth ve Clerk yerine, **organization plugin**'ini kullanan **Better Auth**.

## Gerekçe

- Better Auth, 2026'nın yeni projeleri için en güçlü self-hosted seçenek: NextAuth'tan daha fazla özellik, ücretsiz, aktif bakımda.
- **organization plugin**, çok kiracılı organizasyon yönetimini, davetleri ve üye rollerini/izinlerini kutudan çıktığı gibi kapsıyor — bunu sıfırdan inşa etmek haftalar sürer ve neredeyse her modüle dokunur.
- Auth.js (NextAuth) bakım modunda; Better Auth onun pratik halefi olarak konumlanıyor.
- Self-hosted olması veri egemenliğini bizde tutuyor, Clerk gibi yönetilen bir servise bağımlılık yok — bu, projenin self-hosted, AGPL konumlandırmasıyla tutarlı (bkz. [0007](0007-license-agpl.md)).

**Not:** Better Auth yalnızca backend logic sağlıyor, UI değil. Login, register ve davet-kabul ekranlarını tasarlamak ve inşa etmek bize düşüyor.

## Alan eşlemesi: organization → Workspace

Better Auth organization plugin'i *organization*, *member* ve *invitation* dilini
konuşur. Kurultay'ın ürün dili ve REST API'si **Workspace**, **WorkspaceMember**
ve workspace-scoped davet route'larını kullanır
(`POST /workspaces/:workspaceId/invitations`, …). Eşleme 1:1 kabul edilir:

| Better Auth (plugin) | Kurultay (ürün / API) |
|---|---|
| Organization | Workspace |
| Member | WorkspaceMember |
| Invitation | Invitation (Faz 1'de ayrı Prisma modeli yok) |

Davet persistence'ı Better Auth'un organization tablolarında yaşar. Faz 1 bir
Kurultay `Invitation` modeli **eklemez**; Faz 2 Nest `workspace` modülünü
plugin'e bağlar ve `Workspace` / `WorkspaceMember` satırlarının aynı tablolar mı
(Better Auth ile hizalı Prisma modelleri) yoksa üstünde ince bir sync katmanı mı
olduğuna karar verir. Her iki durumda da public API yanıtları "organization"
kelimesini asla göstermez.

## Entegrasyon riski

Kütüphane seçimi iyi desteklenmiş; *eşleştirme* Better Auth'un sunduğu en az geçilmiş yol, ve bu keşfedilmek yerine baştan bütçelenmeye değer.

- **NestJS entegrasyonu topluluk bakımlı**, birinci taraf değil. Better Auth'un kendi birinci sınıf hedefleri Next.js, Hono ve Elysia; NestJS üçüncü taraf bir modül olan `@thallesp/nestjs-better-auth` tarafından karşılanıyor. Gereksinimleri dışa sızıyor: auth route'ları için NestJS'in **uygulama seviyesi bodyParser'ının devre dışı bırakılmasını** istiyor, bu da her controller'ın body'sini nasıl aldığını etkileyen global bir değişiklik. Bu sürtünme ısırırsa, çıkış yolu Better Auth'un framework-agnostik Node handler'ını doğrudan Express instance'ına monte edip wrapper modülü tamamen atlamak.
- **Better Auth, 1.x içinde kırıcı değişiklikler yapıyor.** 2.0 öncesi ve minor'lar hızlı ilerliyor. Organization plugin, teams şemasını bir kez zaten yeniden yapılandırdı — `member.teamId` kaldırıldı ve yerine bir `teamMembers` tablosu geldi, mevcut kullanıcılar için bir migration gerektirdi. `workspaceId` izolasyon modelimiz ([architecture.md §7](../architecture.md#7-multi-tenant-izolasyonu)) bu tabloların üzerinde oturuyor, dolayısıyla bu çalkantı auth modülünün içinde kalmıyor.
- **Bu yüzden: minor sürümü pinle** (`package.json`'da `^` yok), her bump öncesi release notlarını oku ve bir auth upgrade'ini rutin bağımlılık bakımı değil migration işi olarak ele al.

## Sonuçlar

- Haftalarca sürecek özel org/davet/rol mantığından kaçınılıyor.
- Auth verileri ve session'lar kendi altyapımızda kalıyor.
- Aktif bakım, terk edilmiş bir bağımlılık seçme riskini azaltıyor.
- NextAuth'tan daha yeni bir proje olması, bir şeyler ters gittiğinde dayanılacak daha küçük bir topluluk ve daha az sınanmış örnek anlamına geliyor.
- Her auth akışı için UI/UX yüzeyinin tamamı bize ait — Better Auth başlamak için görsel bir iskelet vermiyor.
- İleride başka bir yere geçmemiz gerekirse, hem backend entegrasyonu hem de etrafına inşa edilen özel UI birlikte taşınmalı.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| Auth.js / NextAuth | Bakım modunda, azalan özellik hızı |
| Clerk | Yönetilen servis — entegre etmesi hızlı ama veri egemenliğinden feragat ettiriyor ve tekrarlayan maliyet ekliyor, self-hosted bir AGPL ürünüyle çelişiyor |
