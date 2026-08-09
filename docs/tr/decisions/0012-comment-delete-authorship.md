# 0012. Yorum Silme Yazarlığı

**Durum:** Kabul edildi
**Tarih:** 2026-08-09

> 🌐 [English (canonical)](../../decisions/0012-comment-delete-authorship.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

[ADR 0011](0011-label-task-metadata-permissions.md) Faz 5 için düz bir kural getirdi: herhangi
bir MEMBER+ erişilebilir bir task'taki herhangi bir yorumu silebilir; yazar-only kontrolü
"ekstra kontrol; kötüye kullanım çıkana kadar ertele" diyerek reddetmişti. MVP tamamlandıktan
sonraki Wave tech-debt sağlamlaştırma geçişinde bu düz kural, ertelediği kötüye kullanım
durumunun kendisi olduğu ortaya çıktı: herhangi bir workspace üyesi yazmadığı bir yorumu
silebiliyordu, "yazar kendi notunu temizledi" ile "üye başkasının yorumunu sildi" ayrımını
yapacak bir denetim izi olmadan. `CommentService.remove` düzeltmesi ADR güncellemesinden önce
gitti; bu kayıt, kodun artık sahip olmadığı davranışı 0011'in tarif etmesi yerine dar kuralı
belgelenmiş karar haline getirir.

## Karar

Yorum silme, çıplak workspace üyeliği değil, **yazarlık veya yükseltilmiş bir rol** gerektirir:

| İşlem     | OWNER | ADMIN | MEMBER (yazar) | MEMBER (yazar değil) | GUEST |
| --------- | :---: | :---: | :------------: | :------------------: | :---: |
| Yorum sil |   ✓   |   ✓   |       ✓        |          —           |   —   |

`CommentService.remove`, `comment.userId === actorId` VEYA
`actorRole ∈ {OWNER, ADMIN}` kontrol eder; başka her durumda `ForbiddenException` fırlatır. Bu,
[ADR 0011](0011-label-task-metadata-permissions.md)'in "Yorum oluştur; erişilebilir task'taki
herhangi bir yorumu sil" satırının yerini alır — o ADR'deki diğer tüm satırlar (label CRUD,
assignee, task metadata) değişmeden kalır.

## Gerekçe

- Başkasının sözünü silmek, kendi sözünü silmekten farklı bir eylemdir; düz kural bunları
  içerik işi (label, assignee, tarih) için düşünülmüş tek bir MEMBER+ kapısı altında
  birleştiriyordu.
- OWNER/ADMIN, kötüye kullanılan veya konu dışı yorumlar için bir moderasyon yedeği tutar —
  0011'in düz kuralının amacı sıfır çaresi olan bir kullanıcı sınıfından kaçınmaktı, yazarlık
  kontrolünden tamamen kaçınmak değil.
- Kontrol, zaten yüklenmiş satırda mevcut olan (`comment.userId`) ve guard'ın çözdüğü
  `actorRole` üzerinden yapılan tek bir ekstra karşılaştırmadır — 0011'in endişelendiği
  "ekstra kontrol" maliyeti gerçekleşmedi.

## Sonuçlar

- `CommentController`, çağıranın `MemberRole`'ünü (`@CurrentMembership()` ile) sadece
  `@Roles`'a güvenmek yerine `CommentService.remove`'a geçirir.
- Web hâlâ silme affordance'ını yazarlıktan bağımsız olarak her `canMutate` (MEMBER+) role
  gösteriyor; kendi yorumu olmayan bir yorumu silen bir MEMBER artık isteğin başarılı olması
  yerine bir `403` toast'ı alır. Butonun yazar olmayanlar için gizlenmesi bir takip işidir, bu
  ADR'nin gerektirdiği bir şey değildir.
- `docs/api-conventions.md` ve `docs/decisions/0011-label-task-metadata-permissions.md`,
  yorum-silme kuralı için özel olarak bu ADR'ye çapraz referans verir.

## Değerlendirilen Alternatifler

| Alternatif                                                 | Neden değil                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 0011'in düz "herhangi bir MEMBER+ silebilir" kuralını koru | 0011'in ertelediği kötüye kullanım durumu — yazar-only çare yok                          |
| Sadece OWNER/ADMIN silebilir (yazar kendi işini yapamaz)   | Üyeler kendi yanlış veya yinelenen yorumlarını geri alamazdı                             |
| "Silen kişi" denetim iziyle soft-delete                    | Makul bir takip işi, ama bu düzeltmenin gerektirdiğinden daha büyük bir şema değişikliği |
