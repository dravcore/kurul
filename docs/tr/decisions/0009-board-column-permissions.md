# 0009. Board ve Column İzinleri

**Durum:** Kabul edildi
**Tarih:** 2026-08-09

> 🌐 [English (canonical)](../../decisions/0009-board-column-permissions.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Faz 3, workspace tenancy altında board ve column mutasyonlarını getiriyor. Nest
zaten ürün route'larını `WorkspaceGuard` + `@Roles` ile kapıyor; Better Auth
organization statement'ları (`@kurultay/auth-access`) yalnızca org/member/invitation
kapsamında — board veya column yok. [design.md](../design.md) column
değişiklikleri için Admin erişimi varsayan bir `403` metni zaten taşıyor.
Handler'lar gelmeden önce açık bir rol matrisi gerekti; böylece API guard'ları
ve UI enablement aynı kalır ve sonraki task-level izinler aynı kalıbı board/column
tartışmasını yeniden açmadan genişletebilir.

## Karar

Board ve column yetkilendirmesi Nest'te `@Roles` ile şu matris üzerinden
uygulanır:

| İşlem                                            | OWNER | ADMIN | MEMBER | GUEST |
| ------------------------------------------------ | :---: | :---: | :----: | :---: |
| Board ve column okuma                            |   ✓   |   ✓   |   ✓    |   ✓   |
| Board oluştur; board adı / açıklama güncelle     |   ✓   |   ✓   |   ✓    |   —   |
| Board sil                                        |   ✓   |   ✓   |   —    |   —   |
| Column oluştur / yeniden adlandır / sırala / sil |   ✓   |   ✓   |   —    |   —   |

## Gerekçe

- Board açmak ve board metadata'sını düzenlemek üyeler için günlük iştir;
  create/update'i yalnızca Admin+'a kilitlemek (Trello/Jira-benzeri olmayan)
  küçük ekipler için sürtünme ekler, gerçek bir güvenlik kazancı vermez.
- Column yapısını değiştirmek board şeklini değiştirmektir. Tasarım dili zaten
  “Column'ları değiştirmek için Admin erişimine ihtiyacınız var” vaadini verir;
  MEMBER column mutasyonu yapmamalıdır.
- Board silmek column ve task'ları cascade eder; bu yıkıcı yüzey OWNER/ADMIN'te
  kalır.
- GUEST, `packages/auth-access` içinde zaten boş bir mutasyon yüzeyine sahiptir;
  board'larda salt-okunur kalması bu duruşla uyumludur.

## Sonuçlar

- Controller'lar board create/update, board delete ve column mutasyonları için
  ayrı `@Roles` setleri uygulamalıdır; tek bir “member yazabilir” kapısı yanlıştır.
- Web UI Admin-only kontrolleri gizler veya disable eder; engellenmiş bir kontrol
  hâlâ erişilebilirse design.md `403` metnini satır içi gösterir.
- Task create/edit/move izinleri
  [ADR 0010](0010-task-permissions.md) ile gelir (MEMBER+ mutasyon; GUEST salt okuma).
- Better Auth AC statement'ları `board`/`column` kaynakları için genişletilmez;
  bu domain'lerde ürün yetkilendirmesi Nest tarafında kalır.

## Değerlendirilen Alternatifler

| Alternatif                                                            | Neden değil                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tüm board ve column mutasyonları yalnızca Admin                       | Küçük ekipler için çok katı; board oluşturma içerik işidir, yapı yönetimi değil                                           |
| MEMBER column oluşturup yeniden adlandırabilir; silme/sıralama Admin  | design.md'nin “column değiştir” Admin metniyle çelişir; column UX'ini iki zihinsel modele böler                           |
| Board/column statement'larını Better Auth organization AC'ye kodlamak | Org plugin yüzeyi workspace üyeliğidir, ürün kaynakları değil; Nest zaten workspace-scoped ürün guard'larını sahipleniyor |
