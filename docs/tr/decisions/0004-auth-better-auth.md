# 0004. Auth: Organization Plugin ile Better Auth

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

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
