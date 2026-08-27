# 0029. İstemci Veri Katmanı El Yapımı Kalıyor; Geçiş Tetikleyicisi Üçüncü Generation Sayacı

**Durum:** Kabul edildi
**Tarih:** 2026-08-23

> 🌐 [English (kanonik)](../../decisions/0029-client-data-layer.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

`apps/web`'in bir veri çekme kütüphanesi yok. Hiç olmadı ve şimdiye kadar bunun nedenini kimse
yazmadı; sonuç olarak her yeni ekran soruyu sıfırdan yeniden tartıştı ve cevap kimin yazdığına
bağlı kaldı. Bu ADR katmanın gerçekte ne olduğunu kayda geçirir, uyduğu kuralları belirtir ve
onu tersine çevirecek tek sayıyı sabitler.

Bugün var olan şey, dört parça halinde:

- **`lib/api.ts`**, tipli bir `fetch` sarmalayıcısıdır: `api.get/post/patch/delete`, artı bir
  reddi doğru cümleye çeviren `apiStatus` ve `resolveApiMessage`. Hiçbir cache, retry ya da
  dedupe taşımaz. Bu kasıtlıdır: HTTP semantiği ve hata eşlemesi, API sözleşmesinin sabitlediği
  parçalardır ([api-conventions.md](../api-conventions.md)) ve durağandırlar.
- **`lib/use-api-resource.ts`**, okuma ilkelidir (primitive): bir `AbortSignal`, bir `loading`,
  bir `error`, bir `failed`, `reload`, ve yerel düzenlemeler için bir `setData`. **Bir değerin
  bir kez gelmesini** modeller ve `fetcher` kimliği onun tüm geçersiz kılma (invalidation)
  hikâyesidir. `null` bir fetcher, bir ekranın workspace id'sini öğrenmeden önce beklemesinin
  yoludur. `useResourceField`, bir setter'ı çok listeli bir kaynağın tek bir alanına daraltır,
  böylece birlikte çekilen dört liste tek bir abort ve tek bir failure olarak kalır. Yaklaşık on
  beş modül bunu kullanıyor.
- **Board hook deseni.** `BoardView` kendi başına hiçbir fetch işlemi yapmaz; her biri tek bir
  sorumluluk taşıyan küçük hook'lardan oluşur ve bu ADR'nin eşlik eden refactor'ü o deseni bir
  seviye daha aşağı taşır: `useBoardCaches` (listeler ve onları yansıtan iki ref), `useBoardFetch`
  (okumalar), `useBoardLoad` (skeleton, error, retry), `useBoardPanelTask` (deep-link'lenen
  satır), `useBoardData` (composer), ardından `useBoardMutations`, `useBoardRealtime`,
  `useBoardTaskDnd` ve `useBoardDialogs`.
- **Socket.io, satır değil id taşır.** `use-board-socket.ts` ve `use-notification-socket.ts` bir
  odaya katılır, handler'larını bir ref'te tutar (böylece kararsız bir callback yeniden abone
  olmaz) ve bir katılımı bir resync isteğiyle onaylar (ack). Payload'lar id'dir
  ([ADR 0005](0005-realtime-socketio.md)), dolayısıyla oluşturulan ya da güncellenen bir görev
  **yeniden çekilir**; bu yüzden istemcinin sunucudan gelen entity'ler için bir merge stratejisine
  ve alan düzeyinde çakışma kurallarına ihtiyacı yoktur.

### Bu kararın dayandığı sayım

"Reconciliation deseninin kopyaları", ROADMAP satırının kısaltmasıdır ve saymak için fazla
gevşektir; bu yüzden kod tabanı üç farklı tanımla üç kez okundu.

**Tam optimistic yazımlar** (snapshot al, tahmin edilen değeri yerelde yaz, sunucunun cevabını
üzerine merge et, başarısızlıkta snapshot'ı geri yükle). **Üç tane:**

| Site                                                                 | Ne tahmin ediyor                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `use-board-mutations.ts` `commitTaskMove`                            | Sürüklenen kartın kolonu ve pozisyonu                               |
| `task-panel-fields.tsx` `save` (bölünmeden önce `task-panel.tsx`'ti) | Görevin başlığı ve açıklaması                                       |
| `use-task-checklists.ts` `toggleItem`                                | Bir checklist tik'i, artı yeniden sayılan `checklistSummary` rozeti |

Yanlarında iki yakın-vaka daha var; kimse yanlışlıkla sayıya dahil etmesin diye adlandırmaya
değer: `task-properties-panel.tsx` içindeki `patchTask` bir snapshot'ı geri yükler ama asla
önceden yazmaz, `workspace-provider.tsx` içindeki `onSwitch` ise `activeId`'yi önceden yazar ama
geri dönecek bir snapshot'ı yoktur.

**Bir sunucu satırını id'yle yerel bir listeye merge etmek**, hiçbir yerel tahmin olmadan. **On
iki tane:** `use-board-realtime.ts` `upsertRemoteTask`, `use-board-fetch.ts` içindeki
`drainTasks`'ın sayfa merge'i, `use-board-panel-task.ts`'in `onSuccess` fold'u, `board-view.tsx`
`applyTaskPatch` ve `onColumnSaved`, `use-task-metadata.ts` `loadMoreComments`,
`notifications-list.tsx` ve `use-notification-menu.ts` `openNotification`, `members-settings.tsx`
iki kez, `board-list.tsx` `onRenamed`, ve `workspace-provider.tsx` `renameActiveWorkspace`.

**Generation ile sayılan yazımlar** (çözüldüğünde, state'e dokunmasına izin verilmeden önce hâlâ
en güncel istek olup olmadığını sormak zorunda olan bir istek). **İki tane:**
`use-board-mutations.ts` içindeki `moveGenerationRef` ve `workspace-provider.tsx` içindeki
`switchGenerationRef`; ikincisi kendi yorumunda birinciyi kopyaladığını söylüyor.

Bu üç sayı taban çizgisidir. On iki alarm verici değil: id ile anahtarlanmış bir merge dört
satırdır ve doğruluğu yereldir. Üç de alarm verici değil. Önemli olan iki, ve bir sonraki bölüm
nedenini anlatıyor.

## Karar

**İstemci veri katmanı el yapımı kalıyor, ve geçiş tetikleyicisi üçüncü generation sayacı.**

`grep -rn "GenerationRef" apps/web` bugün iki sonuç döndürüyor. **Üç döndürdüğünde, web
uygulaması React Query'yi benimser.** Tartışma yok, yeniden ölçüm yok, bu belirli sayacın
kaçınılabilir olup olmadığına dair bir değerlendirme yok.

Bu, ROADMAP satırının "reconciliation deseninin üçüncü kopyası" ifadesinin keskinleştirilmiş
hali; ve olduğu gibi değil keskinleştirilmiş olarak benimseniyor, çünkü gevşek okumada
tetikleyici zaten ateşlenmiş durumda: bugün üç tam optimistic yazım var ve katman gayet iyi.
Deseni parçalarına ayırmak, sayıyı anlamlı kılan şey. Ucuz kısım şekildir: snapshot al, tahmin
et, merge et, geri al; yaklaşık yirmi satır, çağrı noktasında açık ve hata modu içinde yaşadığı
bileşende görünür. Pahalı kısım ise etrafındaki eşzamanlılık muhasebesidir: gelen bir cevaba hâlâ
inanmaya izin verilip verilmediğine karar vermek. Bu akıl yürütme incedir, sessizce yanlış
yapılması kolaydır (yanlış cevap bir çökme değil, doğru görünen bayat bir değerdir) ve tam olarak
bir query kütüphanesinin sizin için üstlendiği şeydir. İki elle yazılmış örnek bir tesadüftür. Üç
ise bir politikadır.

Katmanın uyduğu kurallar, bir sonraki ekranın bunları yeniden türetmemesi için:

1. **Bir kez gelen tek bir değer olan okuma `useApiResource` üzerinden geçer.** Yeni, özel bir
   `AbortController` artı `loading` artı `error` üçlüsü yok. Her `setState`'in etrafındaki
   `if (signal.aborted)` koruması unutulması kolay olan kısımdır ve onu unutmak önceki
   workspace'in satırlarını yeni görünüme yazar.
2. **Farklı zamanlarda gelen birden fazla değer olan okuma el yapımı kalır ve bunu bir yorumda
   söyler.** Bugün tam olarak bir tane var: board yükleme, burada frame ve ilk görev sayfası
   birlikte skeleton'ın ne zaman kalkacağına karar verirken kalan sayfalar zaten çizilmiş bir
   board'un arkasında akmaya devam eder. `useBoardLoad`'ın docstring'i bu argümanı taşır. İkinci
   böyle bir okuma bir tetikleyici değildir ama aynı paragrafı hak etmelidir.
3. **Yazımlar, dokundukları state'in yanındaki bir hook'ta yaşar**, paylaşılan bir mutation
   registry'sinde değil. Optimistic bir ön-yazım opt-in'dir ve her biri gerçekleştireceği
   rollback'i belirtir. Görünür bir gecikme sorunu olmayan bir yazım bunu almaz:
   `use-task-attachments.ts` kasıtlı olarak yalnızca await'ten sonra uygulanır ve docstring'i
   kendisini checklist toggle'ıyla karşılaştırır.
4. **Socket payload'ları id'dir; istemci yeniden çeker.** İstemci tarafında entity cache yok,
   normalization yok, hook'lar arası cache key'i yok. Realtime katmanını merge kurallarından
   arınık tutan şey budur, ve on iki id ile anahtarlanmış merge'in her birinin, kimsenin
   okuyamadığı paylaşılan bir reducer yerine dörder satır olmasının nedeni de budur.
5. **Yeni bir `*GenerationRef` tetikleyicidir, bir kod incelemesi yorumu değil.** Üçüncüsüne
   ihtiyaç duyan kişi onu yazmak yerine React Query migration'ını açar.

**Tetiklendiğinde maliyet**, tetikleyicinin bir alarm değil bir plan olması için şimdiden
belirtiliyor: `@tanstack/react-query` eklenir, `lib/api.ts` fetcher olarak değişmeden kalır,
`useApiResource`'ın imzası `useQuery` üzerinde yeniden uygulanır (böylece tüketicileri çağrı
noktalarına dokunmadan geçiş yapar), üç optimistic yazım `onMutate`/`onError` rollback'iyle
`useMutation`'a taşınır, ve board'un streaming drain'i sayfa başına manuel bir `setQueryData`
olarak bırakılır, çünkü bir kütüphane geldi diye o şekil ifade edilebilir hale gelmez. Bir
rewrite değil, tek odaklı bir değişiklik olarak tahmin ediliyor; beklemenin güvenli olmasının
diğer nedeni de bu.

## Gerekçe

**Neden şimdi React Query değil.** Dürüst sebep, satın alındığı iki şeyin burada henüz sorun
olmaması. Cache'i bileşenler arası dedupe ve bir staleness politikasıdır, ve bu uygulamada mount
edilmiş iki bileşen arasında paylaşılan neredeyse hiç okuma yok: board kendi listelerine sahip,
panel kendi dört metadata listesine sahip, ayarlar ekranlarının her biri birer tane sahip.
Mutation makinesi optimistic-update ergonomisidir, ve üç çağrı noktası, her gelecekteki
katkıcının yeni bir ekran eklemeden önce öğrenmesi gereken yeni bir zihinsel modeli amorti etmez.
Buna karşılık gerçek maliyetler var: şu anda düz bileşenler render eden suite'ler için test
ağacında bir `QueryClientProvider`, ~13 kB gzip'lenmiş, ve herhangi bir kademeli migration
sırasında kalacak `useApiResource` çağrılarının yanında "bu veri nerede yaşıyor" sorusuna ikinci
bir cevap.

**Neden tetikleyici bir tarih ya da dosya boyutu değil de bir sayaç.** Bir tarih, kod tabanı
değişse de değişmese de sona erer. Bir satır sayısı yanlış şeyi ölçer; bu PR'nin eşlik eden
refactor'ünün gösterdiği gibi: `use-board-data.ts` 381 satırdan 158'e indi ama mantığının tek bir
satırı bile basitleşmedi, çünkü satırlar üst üste yığılmış dört sorumluluktu, çok büyük olan tek
bir sorumluluk değil. Bir generation sayacı ise tam tersine, biri gerçek istek eşzamanlılığıyla
karşılaştığında ve onu elle çözmeye karar verdiğinde ortaya çıkar. Grep'lenebilir, herkes
tarafından tek bir komutla sayılabilir, ve tartışılarak küçültülemez.

**Neden el yapımı katman yalnızca ucuz değil, kendi şartlarında savunulabilir.** Her iki ilkel
de zaten takımların genelde bir kütüphane benimseyerek doğru yapmaya çalıştığı şeyi yapıyor.
`useApiResource`, `loading`/`error`'ı effect'in başından değil, istek kimliği değiştiğinde render
sırasında ayarlar; bu da bir tüketicinin önceki isteğin hatasının yanında `loading === false`
okuduğu bütün bir tek-frame yalan sınıfını ortadan kaldırır. Board yüklemesi sonuncu değil ilk
sayfada açılır. Her iki socket hook'u da `connected`'ı yalnızca oda gerçekten katılıldığında
çevirir, böylece bağlanıp odaya kabul edilmeyen bir socket canlı görünmez. Bunların hiçbiri bir
query kütüphanesiyle de bedava değil; bunlar migration'dan değişmeden çıkacak uygulama mantığı.

## Sonuçlar

- **Aktivite akışının önü açıldı.** Beyond MVP satırındaki
  [Realtime push of the activity feed](../../../ROADMAP.md#beyond-mvp) bu ADR'yi bekliyordu, ve
  beklediği şey "bunu hangi katmanda inşa edeceğim" sorusunun cevabıydı. Artık zaten var olan ve
  yeni bir state eklemeyen deyimle inşa edilebilir: panelin yorum yolu bunu zaten yapıyor.
  `use-board-realtime.ts`'in `onCommentAdded`'ı seçili görev için `metaRefreshKey`'i artırır, bu
  key `useTaskMetadata`'nın fetcher kimliğinin bir parçasıdır, ve değişen bir fetcher kimliği
  `useApiResource`'ın reload olarak ele aldığı şeydir. Board odasında push edilen bir aktivite
  olayı aynı key üzerinden aynı şeyi yapar. Yapmaması **gereken** şey, yalnızca ekleme yapılan ve
  sunucu tarafından sıralanan bir akış için dördüncü bir optimistic yazım ya da üçüncü bir
  generation sayacı getirmektir; eğer buna ihtiyacı olduğu ortaya çıkarsa, bu tetikleyicinin
  ateşlenmesi demektir ve akış migration'ı bekler.
- 1. kural, `useApiResource`'ı yeni okuma ekranları için varsayılan cevap yapar; bu bir kolaylık
     olduğu kadar katkıcılar üzerinde bir kısıtlamadır: incelemede özel bir fetch üçlüsü artık
     karşılaştırılacağı bir belgeye sahip.
- Katman bilinen boşluklarını korur; sonradan keşfedilmek yerine adlandırılmış: bileşenler arası
  istek dedupe'u yok, pencere odaklandığında refetch yok, arka plan staleness'ı yok. Bunlardan
  herhangi biri istendiğinde yerel ve dar kapsamlı olarak çözüldü; `lib/use-poll-fallback.ts`'in
  ne olduğu da bu.
- Testler provider'sız kalır. Board ve görev suite'leri bileşenleri ve hook'ları doğrudan render
  eder; case'ler arasında kurulacak ya da sıfırlanacak bir client yoktur.
- Üç optimistic yazım özel kalır, ve her biri rollback yolu için kendi testine ihtiyaç duymaya
  devam edecek. Bu, bu kararın kabul edilmiş tekrarlayan maliyeti, ve tetikleyicinin izlediği
  maliyet de bu.

## Değerlendirilen alternatifler

| Alternatif                                                             | Neden olmadı                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Şimdi React Query'yi benimsemek                                        | Uygulamanın doldurmak için neredeyse hiç paylaşılan okuması olmayan bir bileşenler arası cache satın alır, ve üç çağrı noktası için mutation ergonomisi; her test ağacında bir provider'a ve migration sırasında ikinci bir veri akışı deyimine mal olur |
| Bunun yerine SWR                                                       | Daha küçük boyutta aynı takas, ve gerginlik gösteren tek yarı olan mutation yarısı hakkında söyleyecek daha az şeyi var                                                                                                                                  |
| Board ve görev state'i için global bir store (Zustand, Redux)          | Sunucu state'ini istemci state'ine taşır; bu tam olarak socket katmanının etrafında tasarlandığı kategori hatasıdır: API otoriter kalır ve payload'lar id taşır                                                                                          |
| İç kaynaklı, normalize edilmiş bir entity cache                        | Bir query kütüphanesinin en zor parçasını benimser ama test, doküman ya da topluluğunun hiçbirini almaz; tetikleyiciyi çevirmekten kesinlikle daha kötü                                                                                                  |
| Board için Server Components artı Next'in `fetch` cache'i              | Board bir session cookie'sinin arkasında canlı, sürüklenen, socket ile güncellenen bir yüzey; burada hiçbir şey istek başına cache'lenebilir ya da bir kez render edilebilir değil                                                                       |
| Şimdiden genel, iç kaynaklı bir `useMutation` sarmalayıcısı            | Optimistic şekilleri farklı olan üç çağrı noktası (bir liste yeniden sıralama, iki alan patch'i, yeniden sayılan bir özet) her biri için bir kaçış kapısına ihtiyaç duyar; geriye soyutlama artı özel durumlar kalır                                     |
| Bunun yerine bir dosya boyutu ya da çağrı noktası sayısı tetikleyicisi | Katmanlaşmanın belirtilerini sayar, zorluğun belirtilerini değil; `use-board-data.ts` bu aynı PR'de mantık değişmeden %58 küçüldü                                                                                                                        |
| Tetikleyici yok, "acıttığında" yeniden gözden geçir                    | Bu ADR'nin sona erdirmek için var olduğu durum tam olarak bu: soru ekran başına yeniden tartışıldı ve soranın cevabı geçerli oldu                                                                                                                        |

</content>
</invoke>
