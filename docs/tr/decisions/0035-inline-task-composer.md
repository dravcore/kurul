# 0035. Satır İçi Task Composer: Column'un Dibinde Tek Bir Oluşturma Yolu ve Bir Başlık İçin Dialog Yok

**Durum:** Kabul edildi
**Tarih:** 2026-08-26

> 🌐 [English (kanonik)](../../decisions/0035-inline-task-composer.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

[design.md](../design.md) §5, board'u bloklamasına izin verilen etkileşimleri sayıyor:
"Confirmations, board creation, and destructive actions stay **dialogs**; those genuinely need to
block." Task oluşturmak bu listede yok, hiçbir zaman da olmadı. Yine de bir dialog'u var.

`apps/web/components/task/create-task-dialog.tsx` 68 satır. Tek bir `Input`'u `title`'a bağlayan
bir `FormDialog` render ediyor, `{ title, columnId }` gövdesini
`/workspaces/{workspaceId}/boards/{boardId}/tasks` adresine POST ediyor, oluşan `TaskDto`'yu
`onCreated` ile geri veriyor ve kendini temizliyor. Başka hiçbir şey toplamıyor.
`apps/web/components/board/board-dialogs.tsx` içinden mount ediliyor ve `useBoardDialogs`
tarafından sürülüyor; onun `createTaskColumnId` alanını da her column'un dibindeki ghost
`Add task` butonu ayarlıyor (`apps/web/components/board/board-column.tsx`, 264 ile 275. satırlar,
yalnızca `canMutateTasks` iken render ediliyor).

Yani task panel'in zaten düzenleyebildiği tek bir dizgeyi okumak için board bir scrim ile
örtülüyor, focus tuzağa alınıyor ve çevredeki kartlar gizleniyor. Bir task'ın sahip olduğu diğer
her şey, açıklama, öncelik, bitiş tarihi, tahmin, atananlar, etiketler, checklist'ler, ek'ler,
sonrasında sağdaki panel'de dolduruluyor, çünkü o alanların yaşadığı yer panel
(`task-panel.tsx`, `task-detail-fields.tsx`, `task-metadata-panel.tsx`).

Bu bedel kart başına ödeniyor ve kartlar teker teker oluşturulmuyor. Planlama sırasında bir
column'u doldurmak demek aç, yaz, gönder, dialog'un kapanmasını bekle, butona yeniden tıkla
demek. Bir sonraki başlığı bariz kılan bağlam, yani column'da hâlihazırda duran kartlar, tam da
modal'ın başlık yazılırken örttüğü şey.

design.md §5 ayrıca "Faz 4+" için bir çıplak harf kısayolu kümesini reserve ediyor: `⌘K` command
palette, `C` create task, `/` filter, `?` help. Bugün yalnızca `/` uygulanmış durumda
(`apps/web/components/board/board-filter-search.tsx`, 35 ile 51. satırlar). Bu yüzden bir task'ın
nasıl oluşturulduğuna karar vermek, aynı zamanda oluşturma kısayolunun neyi odaklayacağına ve
gelecekteki bir command palette'in neyi açmaya hakkı olduğuna da karar veriyor; bunun bir karar
kaydı olmasının, bir uygulama detayı olmamasının sebebi bu.

## Karar

### 1. `Add task` butonu, açtığı alanın kendisi olur

`Add task`'a tıklamak, butonun yerine aynı genişlikte tek satırlık bir metin alanını, column'un
dibindeki aynı konuma koyar. Yüzey yok, scrim yok, header yok, başlık yok: column kendi zeminini
korur ve alanın üstündeki her kart görünür ve tıklanabilir kalır.

Alan, bu ağaçtaki diğer form alanları gibi bir form alanıdır, dolayısıyla alan kurallarını
olduğu gibi alır: `text-base md:text-body` (768px altında 16px, üstünde 13/18) ve 768px altında
44px dokunma hedefi. Tek `:focus-visible` outline'ını `@layer base`'den çizer, kendine ait bir
ring eklemez.

### 2. `Enter` oluşturur ve kalır, `Escape` ile boş alandaki blur butona döner

`Enter`, kırpılmış başlıktan task'ı oluşturur, kartı column'a ekler, alanı boşaltır ve focus'u
alanın içinde bırakır. Bir sonraki başlık, imleç ve ikinci bir tıklama olmadan hemen yazılır.

`Escape` composer'ı kapatır ve focus'u `Add task` butonuna geri verir. **Boş** bir alandan blur
olmak da aynısını yapar. İçinde hâlâ metin olan bir alandan blur olmak composer'ı açık bırakır:
yazılmış bir başlık kaçak bir tıklamayla asla atılmaz, onu kaybetmenin tek yolu silmektir.

Oluşturma isteği yoldayken composer biçimini korur. Etiketini bir bekleme dizgesiyle
değiştirmez; beklemesi gereken her kontrol için mevcut `Button` `loading` durumunu kullanır
(`aria-busy` ve `disabled` birlikte, etiket altta durur) ve bekleme durumu focus'u alanın
dışına asla taşımaz.

### 3. Tek bir ek kontrol, `Open details`, ve panel'i açar

Composer, alanın yanında tam olarak tek bir kontrol taşır: `Open details`. Yazılmış olandan
task'ı oluşturur ve yeni kartın task panel'ini açar. Alan boşken devre dışıdır, çünkü açılacak bir
kart henüz yoktur. Bir dialog açmaz ve ikinci bir form değildir.

"Peki diğer alanlar ne olacak" sorusunun tüm cevabı budur: zaten yaşadıkları yerde doldurulurlar.
Composer bir başlık toplar, çünkü bir kartın var olmak için ihtiyaç duyduğu tek şey bir başlıktır.

### 4. `CreateTaskDialog` silinir ve yerine bir şey gelmez

`apps/web/components/task/create-task-dialog.tsx`, `board-dialogs.tsx` içindeki mount'u ve
`useBoardDialogs` içindeki `createTaskColumnId` state'i ile birlikte kaldırılır. Üründe başka
hiçbir yüzey task oluşturmaz. Kararın bağlayıcı yarısı budur: "board composer'ı tercih eder"
değil, "composer tek yoldur"; böylece doğru yapılacak tek bir davranış kümesi, bir hatanın
düzeltileceği tek bir yer ve aynı alanı toplayan iki form arasında sürüklenme ihtimali olmaz.

### 5. `c` ilk column'un composer'ını açar ve odaklar

Modifier'sız çıplak bir `c`, board'un ilk column'undaki composer'ı açar ve imleci içine koyar.
Guard, `/` kısayolunun zaten kullandığı guard'dır: handler, `metaKey`, `ctrlKey` veya `altKey`
basılıysa döner ve event target'ı bir `INPUT`, bir `TEXTAREA` ya da `contentEditable` bir eleman
ise döner, böylece bir alana yazılan `c` bir harftir, kısayol değil. Ancak bundan sonra
`preventDefault` çağırır ve focus'u taşır.

Bu, design.md §5'in create task için zaten reserve ettiği harftir. ADR yeni bir tuş talep etmez;
reserve edilmiş olanı map eder ve karara bağladığı şey o tuşun ne yaptığıdır: bir şey açmak değil,
composer'ı odaklamak. design.md reserve listesinde harfi `C` olarak yazar; handler'ın eşleştirdiği
tuş, Shift'siz `c`'dir, çünkü Shift onu modifier'lı bir tuş yapardı. Reserve listesinin kalanına
dokunulmaz.

### 6. Gelecekteki command palette kendine ait bir create-task dialog'u almaz

`⌘K` geldiğinde, onun task oluşturma aksiyonu tıpkı `c` gibi composer'ı odaklar. Palette, tek
oluşturma yoluna ulaşmanın bir yoludur, asla ikinci bir yol değildir. Bu, palette daha ortada
yokken şimdi söyleniyor, çünkü ikinci yolun geri gelmesinin en bariz biçimi "palette'in kendi
hızlı ekleme dialog'una ihtiyacı var" cümlesidir.

## Gerekçe

- **Dialog zaten yazılı kuralın dışındaydı.** design.md §5 bloklama çizgisini onay, board
  oluşturma ve yıkıcı eylemlerde çiziyor. Bir create-task modal'ı hiçbir zaman bu çizginin içinde
  olmadı; bir karar onu oraya koyduğu için değil, ilk yapılan şey olduğu için hayatta kaldı. Onu
  kaldırmak, dokümanı koda değil kodu dokümana uydurur.

- **Board'da oluşturmak tekrarlıdır ve modalite tekrarı vergilendirir.** Her kart, yazmanın
  üstüne bir açma ve bir kapama maliyeti getirir. Composer'ın `Enter` döngüsü ikisini de kaldırır
  ve imleci bir sonraki başlığın gideceği yerde tutar, böylece bir column'u doldurmak kesintisiz
  tek bir eylem olur.

- **Çevredeki kartlar girdinin kendisidir.** Bir column'a neyin ait olduğuna, orada zaten duran
  şey karar verir. Bir modal tam olarak onu gizler, üstelik az önce beliren kartı da gizler,
  yani kullanıcı bir sonrakini yazarken son oluşturmanın sonucunu göremez.

- **Tek yol bir tercih değil, bir davranış bütçesidir.** İki oluşturma yüzeyi demek iki focus
  hikâyesi, iki bekleme durumu, iki hata durumu, iki mesaj anahtarı kümesi ve bunların
  çelişmesi için iki şans demektir. Klavye kısayolunun ve gelecekteki palette'in aynı alanı
  göstermesi, bu bütçeyi bir'de tutan şeydir.

- **Form zaten panel'dir.** Composer'ın toplamadığı her alan task panel'de zaten uygulanmış,
  yerleşimi yapılmış ve izin kontrolünden geçmiş durumda. Onların bir alt kümesini toplayan
  ikinci bir form, bu işi daha az yerin olduğu ve büyümeye yerin olmadığı bir noktada
  çoğaltırdı.

- **Reserve bir harf, ancak ona cevap veren bir şey olduğunda gerçek olur.** design.md §5,
  `C`'yi create task için, ona açacak bir şey daha ortada yokken reserve etti. Onun açtığı şey
  composer'dır, dolayısıyla composer'ı yaratan ADR, o reservasyonun not olmaktan çıkıp bağlayıcı
  hale geldiği yerdir.

## Sonuçlar

- **Composer'daki bir regresyon task oluşturmayı imkânsız kılar.** Geri düşülecek bir dialog
  kalmadı ve hata kısmi değil tam bir hatadır. Bu yüzden iki yol da `e2e/tests/` altındaki
  tarayıcı e2e'siyle kapsanır (`pnpm test:browser`): imleç yolu (`Add task`'a tıkla, yaz,
  `Enter`, kart belirir) ve klavye yolu (`c`, yaz, `Enter`, focus hâlâ boşalmış alandadır).
  Bileşen testleri bunun yerine geçemez, çünkü bozulan şey gerçek bir tarayıcıdaki focus ve tuş
  işleyişidir.

- **Dokunma ve küçük ekranlar kararın sonrasında değil içindedir.** Alan 768px altında 16px'tir
  (bunu 360px e2e taraması zorlar ve iOS'un focus'ta board'u zoomlamasını durduran şey budur) ve
  composer satırı 44px dokunma hedefini korur. Bu ikisinden birinde başarısız olan bir alan,
  artık tek giriş yolu olduğu için, telefonda kullanılamayan bir board demektir.

- **Composer odaktayken arrow tuşları imlecindir.** Board, `Tab`'ın bir column'a ulaştığı ve
  arrow'ların onun içinde hareket ettiği bir composite widget'tır. Odaklanmış bir metin alanı
  arrow tuşlarını imleç hareketi için alır; board'un roving focus'u composer kapandığında geri
  gelir.

- **Mesaj kataloğu yer değiştirir.** Dialog'un anahtarları gider, composer'ın placeholder'ı ve
  `Open details` etiketi gelir, aynı commit içinde `apps/web/messages/en.json` ve
  `apps/web/messages/tr.json` dosyalarında. `apps/web/messages/turkish-screens.test.tsx` en uzun
  elli Türkçe dizgeyi literal bir uzunluk iddiasıyla sabitler, dolayısıyla her katalog
  değişikliği o listeyi de tazeler.

- **Keşfedilebilirlik biraz geriler.** Başlıklı bir modal, kendini bir metin satırından daha
  yüksek sesle duyurur. Bunu taşıyan şey giriş noktasının değişmemesidir: kullanıcı hâlâ aynı
  yerdeki aynı `Add task` butonuna tıklar ve alan, kartın belireceği yerde belirir.

- **Dialog'lar kalan kapsamlarını korur.** Onay, board oluşturma ve yıkıcı eylemler design.md
  §5'e göre bloklamaya devam eder. Column ve task silme dialog'ları ile column oluşturma ve
  ayarlar dialog'ları bu kararın dışındadır ve bu karar onlara dokunmaz.

## Değerlendirilen Alternatifler

| Alternatif                                                     | Neden değil                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateTaskDialog`'u olduğu gibi korumak                       | Panel'in zaten düzenleyebildiği tek bir dizgeyi toplamak için board'u bloklar ve ne yazılacağına karar veren kartları gizler; ayrıca design.md §5'in neyin bloklayabileceğine dair kendi listesinin dışında durur       |
| İkisini birden tutmak, dialog ve composer                      | Tek bir aksiyon için iki focus hikâyesi, iki bekleme ve hata durumu ve iki mesaj anahtarı kümesi, çelişmekte özgür; tek yol kararın yan etkisi değil amacıdır                                                           |
| Oluşturmada hafif bir quick-view popover                       | Yine board'un üstünde, kendi kapanma ve focus geri verme kurallarıyla bir layer'dır ve gösterebileceği her alanın zaten yaşadığı task panel ile rekabet eder                                                            |
| Öncelik, bitiş tarihi ve etiketleri de toplayan bir composer   | Panel'in alanlarını column genişliğinde bir satırda yeniden kurar, izin kontrollü ve yerelleştirilmiş kalması gereken yüzeyi ikiye katlar ve composer'ın var olma sebebini, arka arkaya altı başlık yazmayı, yavaşlatır |
| Command palette'e ileride kendi hızlı ekleme dialog'unu vermek | Palette indiğinde ikinci yolu yeni bir adla geri getirir; hiçbir şey ona bağlı değilken şimdi karara bağlamak bedelsizdir ve kapıyı kapatır                                                                             |
