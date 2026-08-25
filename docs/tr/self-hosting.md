# Kurul'u kendi domain'inizde barındırma

Kurul'u bir sunucuya, kendi domain'inize, HTTPS ve çalışan e-posta ile kurun. Aşağıdakilerin
tamamı bilinçli olarak tek sayfa; çoğu DNS beklemekle geçen yaklaşık bir saat ayırın.

> 🌐 [English (canonical)](../self-hosting.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

Build adımı yok. `docker compose pull` her sürüm için yayınlanan imajları indirir ve aynı imaj
her domain'de çalışır — API URL'i imajın içine derlenmiş değildir (gerekçesi için bkz.
[Neden yeniden build gerekmiyor](#neden-yeniden-build-gerekmiyor)).

> **v0.2.0 ya da daha eskisini mi kuruyorsunuz? Bunun yerine `git clone` kullanın.** v0.2.0
> ve öncesi sürümler yalnızca `api` ve `web` imajlarını yayınladı; bu sayfanın çektiği üçüncü
> imaj olan `kurul-migrate`, v0.3.0'dan itibaren var. Aşağıdaki indirme adımı build edilecek
> bir kaynak ağacı getirmediği için v0.2.0'da bu sayfadaki adımlar stack'i başlatamaz:
> [Sorun giderme](#sorun-giderme) bölümünde gösterildiği gibi clone'dan kurun ve v0.3.0'dan
> itibaren bu sayfaya dönün.

## Gerekenler

- Public IP'si olan, Docker Engine 24+ ve Compose eklentisi kurulu bir sunucu. Küçük bir ekip
  için iki CPU ve 2 GB RAM yeterli — bu 2 GB'ın nasıl harcandığı için bkz.
  [Sunucu boyutlandırma](#sunucu-boyutlandırma).
- Kontrolünüzdeki bir domain ve o sunucuya **açık 80 ve 443 portları**. İkisi de zorunlu:
  Let's Encrypt doğrulamayı 80 üzerinden yapar, tarayıcılar 443'ü kullanır.
- Bir SMTP hesabı. Kurul'da davetlerin kabul edilebilmesi için giden e-posta şart —
  nedeni ve atlarsanız ne olduğu için bkz. [E-posta](#e-posta-smtp).
- Gelen trafikte SSH, 80 ve 443 dışında hiçbir şeye izin vermeyen bir host firewall'ı. Bu
  stack'in çalıştırdığı geri kalan her şey zaten kendiliğinden public internetin dışında kalır:
  `docker-compose.yml` içinde `ports:` tanımı olan tek servis `proxy`, dolayısıyla Postgres,
  Redis, API ve web uygulamasına yalnızca Docker'ın iç ağı üzerinden erişilebilir. Bunu kendi
  makinenizde `docker compose ps` ile doğrularsınız — `proxy` dışındaki her satır, önünde
  `0.0.0.0:` eşlemesi olmayan çıplak bir container portu (`4000/tcp`, `5432/tcp`, …)
  göstermeli.

  Firewall yine de yerini hak ediyor; ona güvenmeden önce bilinmesi gereken bir neden var:
  Linux'ta Docker portları kendi iptables kurallarını yazarak yayınlar ve bu kurallar ufw'nin
  kurallarından **önce** değerlendirilir. Yayınladığınız bir container portu — diyelim
  Postgres'e "geçici olarak" ulaşmak için bir `docker-compose.override.yml`'de — `ufw deny 5432`
  yazılı olsa bile internete açıktır. Firewall, Docker'ın yönetmediği şeyleri korur; geri kalanı
  koruyan şey `ports:` listesidir — bu stack'in o listeyi tek servise indirmesinin nedeni budur.

## Sunucu boyutlandırma

`docker-compose.yml`'deki her servis artık bir `mem_limit` taşıyor (OPS-05, 2026-08-18 audit).
Bundan önce hiçbir şey bir container'ın alabileceği belleği sınırlamıyordu, dolayısıyla 2 GB
bütçesine yaklaşan bir host'ta hangi process'in öleceğine _kernel_'in OOM killer'ı karar
veriyordu — sadece bu stack'inkileri değil, host'taki her process'i puanlar ve gerçekte
büyüyen container hangisiyse onun yerine Postgres'i esirgemek için hiçbir sebebi yoktur. Bir
`mem_limit`, bu kararı ait olduğu yere geri koyar: bir container yalnızca kendi tavanını aştığı
için öldürülür ve başka bir servisin yaptığı hiçbir şey Postgres'i onunla birlikte
düşüremez.

| Servis     | `mem_limit` | Bu sayının nedeni                                                                                |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `postgres` | 512m        | Küçük bir ekibin board'u için cömert bir taban                                                   |
| `api`      | 512m        | `REQUEST_BODY_MAX_BYTES` / `ATTACHMENT_MAX_BYTES` (`.env.example`) ikisi de heap'ine buffer'lar  |
| `web`      | 512m        | Aynı Next.js SSR process'i, `api` ile aynı "seçilmemiş tavan" sorunu                             |
| `migrate`  | 512m        | `api` ile aynı — aynı build stage, aynı Prisma CLI, yalnızca startup'ta bir kez                  |
| `backup`   | 256m        | `pg_dump` buffer'lamak yerine stream eder; bu, process overhead'i ve attachment `tar`'ını kapsar |
| `redis`    | 128m        | Yalnızca cache, session, rate limit, bildirim — asla board verisi, küçük ve sınırlı working set  |
| `proxy`    | 128m        | TLS sonlandırır ve proxy'ler; gövdeler `api`'ninki gibi buffer'lanmak yerine Caddy'den geçer     |

`api` ve `web`, 512m tavanlarının %75'i olan `NODE_OPTIONS=--max-old-space-size=384`'ü de
ayarlar — böylece V8'in heap'i, Node'un kendi container-belleği sezgisine bırakılmak yerine
açıkça sabitlenir. `mem_limit`'in altında kalan 128m'lik boşluk, tek başına bir heap tavanının
kapsamadığı şeyler içindir (thread stack'leri, native buffer'lar, code space): V8, cgroup'un
sert limitine varmadan önce kendi yakalanabilir "JavaScript heap out of memory" hatasına çarpar
— bu da çıplak bir `SIGKILL` yerine `docker compose logs api` (ya da `web`) içinde bir satır
olarak görünür.

Bunlar birer tavan, rezervasyon değil — `mem_limit`'inden az kullanan bir container hiçbir ek
maliyete yol açmaz, ve özellikle `migrate`, `api` ile `web` başlamayı bitirmeden önce (başarıyla)
çıkar, dolayısıyla onlarla hiçbir zaman gerçekten eşzamanlı değildir. Uzun süre çalışan servisler
— `postgres`, `api`, `web`, `redis`, `proxy` ve `backup` — tavanlarına aynı anda vurmuş gibi
toplarsak (diğerleri ayaktayken zaten çıkmış olan `migrate` hariç), bu 512 + 512 + 512 + 128 +
128 + 256 = 2048 MB eder, ki bu da bu sayfanın her zaman istediği 2 GB'a tam olarak denk gelir.
Gerçek trafik altında bundan daha az boşluğu olan bir host, bu sayıları yükseltmek için bir
sebeptir (`docker-compose.yml` düz bir düzenleme, ya da bunları bir
`docker-compose.override.yml` içinde override edin) veya kutunun kendi RAM'ini artırmak için —
tavanı kaldırmak için değil; bunun size ne kaybettireceği için yukarıdaki notu görün.

**Ölçümle doğrulanmadı**: bu sayılar `.env.example`'da zaten belgelenmiş request/attachment
tavanlarından ve V8'in kendi heap boyutlandırma kurallarından geliyor, stack'in her limitte
yük altında çalıştırılmasından değil. Bir container gerçekte `mem_limit`'ine çarptığı için
öldürülürse, `docker compose ps` onun çıktığını gösterir (genelde `137`), ve
`docker compose logs <servis>` başlanacak yerdir — her servisin değil, o tek servisin limitini
yükseltin.

## 1. DNS

Hostname'i sunucunuza yönlendirin ve stack'i başlatmadan önce yayılmasını bekleyin — Caddy ilk
açılışta sertifika ister ve DNS henüz canlı olmadığı için başarısız olan bir istek Let's
Encrypt'in rate limit'ine sayılır.

```
kurul.example.com.   A     203.0.113.10
kurul.example.com.   AAAA  2001:db8::10      # yalnızca sunucunun IPv6'sı varsa
```

Sunucunun kendisi dışında bir yerden doğrulayın:

```bash
dig +short kurul.example.com
```

## 2. Compose dosyasını indirin ve yapılandırın

Aşağıdaki URL'ler bir release tag'i taşıyor, `v0.3.0`, ve aynı tag birkaç satır aşağıda `.env`'e
`TAG` olarak giriyor. Dosyaları `main`'den değil, çalıştıracağınız sürümden indirin:
`docker-compose.yml`, `docker/Caddyfile` ve `scripts/backup.sh` imajlarla birlikte sürümlenir
ve daha yeni bir ağaçtan gelen bir compose dosyası, sabitlediğiniz sürümün hiç yayınlamadığı
bir servisi, değişkeni ya da imajı adlandırabilir. Başka bir sürümü kurmak için her URL'deki ve
`TAG`'deki `v0.3.0`'ı değiştirin.

```bash
mkdir -p /opt/kurul && cd /opt/kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/v0.3.0/docker-compose.yml
curl -fsSL --create-dirs -o docker/Caddyfile \
  https://raw.githubusercontent.com/dravcore/kurul/v0.3.0/docker/Caddyfile
curl -fsSL --create-dirs -o scripts/backup.sh \
  https://raw.githubusercontent.com/dravcore/kurul/v0.3.0/scripts/backup.sh
chmod +x scripts/backup.sh
curl -fsSL -o .env https://raw.githubusercontent.com/dravcore/kurul/v0.3.0/.env.example
chmod 600 .env
```

`scripts/backup.sh` isteğe bağlı değil: `docker-compose.yml` içindeki `backup` servisi tam
olarak o yolu container'ına bind-mount eder ve dosya yoksa o servisin var olma amacı olan
zamanlanmış yedekler hiç alınmaz. `chmod 600 .env`, çünkü dosya birazdan veritabanı parolasını,
oturum sırrını ve SMTP parolasını taşıyacak; [Host dışı kopyalar](#host-dışı-kopyalar)
bölümündeki `rclone.env` tavsiyesi de aynı kural.

`.env`'i düzenleyin. Yalnızca Docker ile kurulumda önemli olan satırlar şunlar — dosyadaki geri
kalan her şey ya geliştirme döngüsü için ya da çalışan bir varsayılana sahip:

```bash
TAG=v0.3.0                                  # yukarıdaki dosyaların geldiği sürüm

SITE_URL=https://kurul.example.com          # domain'iniz, şema dahil

POSTGRES_PASSWORD=<openssl rand -hex 32>       # base64 değil hex — bir URL'in içine giriyor
BETTER_AUTH_SECRET=<openssl rand -hex 32>      # oturum imzalama anahtarı

SMTP_HOST=smtp.example.com                     # aşağıdaki "E-posta" bölümüne bakın
SMTP_PORT=587
SMTP_USER=kurul@example.com
SMTP_PASSWORD=<smtp parolanız>
SMTP_SECURE=false                              # yalnızca 465 portu için true
MAIL_FROM=Kurul <kurul@example.com>
```

İki gizli değeri de `openssl rand -hex 32` ile üretin. `POSTGRES_PASSWORD` doğrudan bir bağlantı
URL'inin içine giriyor; `-base64` çıktısındaki bir `/` orada URL'i keser — `-hex`'in alfabesinde
(`0-9a-f`) böyle bir karakter yok. `BETTER_AUTH_SECRET` yalnızca byte byte karşılaştırılıyor,
yani bu kısıtı taşımıyor, ama onu da `-hex` ile üretmek, değişken başına ayrı bir kural yerine
tek bir üreticiyi akılda tutmak demek.

`SITE_URL` şemayı taşır, çünkü Caddy'nin düz HTTP mi sunacağına yoksa sertifika mı alacağına
karar veren şey odur. `https://…` otomatik HTTPS'i açar. `http://localhost` (varsayılan) ise
domain'siz yerel kurulumdur.

**Attachment'lar için burada bir satır gerekmiyor.** `docker-compose.yml` `STORAGE_PATH`'i
kendisi, `attachment_data` volume'ünün içindeki bir dizine ayarlar; yani Compose kurulumu kutudan
çıktığı hâliyle dosya yüklemeyi kabul eder — o değişkenin `.env`'deki kopyası yalnız geliştirme
döngüsü içindir. Değiştirmek isteyebileceğiniz tek değer `ATTACHMENT_MAX_BYTES` (varsayılan
`26214400`, 25 MiB) ve değiştirecekseniz önce
[aşağıdaki proxy sözleşmesini](#kendi-reverse-proxynizi-kullanmak) okuyun: ters proxy, onunla
birlikte hareket etmesi gereken ayrı ve bilinçli olarak daha yüksek bir tavan taşıyor.

**Attachment depolaması varsayılan olarak sınırlıdır ve Postgres'in diskini paylaşır.**
`attachment_data` volume'ü veritabanıyla aynı host dosya sisteminde yaşar; dolu bir disk yalnız
yüklemeleri değil, Postgres'i durdurur. Toplamı iki değişken sınırlar
([ADR 0027](decisions/0027-attachment-quotas.md), 2026-08-21'de güncellendi):
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` (workspace başına saklanan dosya baytlarının toplamı) ve
`ATTACHMENT_INSTANCE_QUOTA_BYTES` (instance'ın tamamı). Ayarlanmadıklarında **workspace başına
2 GiB (`2147483648`), instance başına 20 GiB (`21474836480`)** geçerlidir; yazılı bir `0` ilgili
tavanı tamamen kaldırır, negatif değer açılışta reddedilir. Diskini önemsediğiniz her makinede
instance olanını volume'ün gerçek boş alanının altına ayarlayın. API geçerli sayıları açılışta
loglar (`docker compose logs api` içinde `Attachment ceilings: … (default)` / `(env)`) ve
workspace kotası instance kotasının üstüne ayarlanmışsa reddetmek yerine uyarır.
Boyutlandırırken bilin: kotalar **yumuşaktır** (eşzamanlı yüklemeler en fazla birer dosya
aşabilir; birkaç `ATTACHMENT_MAX_BYTES` kadar pay bırakın) ve silinen dosyalar baytlarını gecelik
orphan süpürmesinin bekleme süresi geçene kadar tutar; yani disk kullanımı, kota muhasebesini
kısa süre aşabilir. Bağlantı ekleri bayt saklamaz ve hiç sayılmaz. Reddedilen yükleme, JSON
gövdesi `error: "Attachment Quota Exceeded"` taşıyan bir `413`'tür, bkz.
[413'leri birbirinden ayırmak](#413leri-birbirinden-ayırmak).

**Yüklemelerin dakikada bayt bütçesi de var.** `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` (varsayılan
`268435456`, 256 MiB, yaklaşık on tam boy yükleme) bir istemci IP'sinin sabit bir dakika içinde
yükleme rotasına gönderebileceği en fazla bayttır; her isteğin `Content-Length`'i gövde
okunmadan önce bütçeden düşülür (`Content-Length` taşımayan bir multipart istek
`ATTACHMENT_MAX_BYTES` kadar düşülür). Var olma nedeni, rota başına istek throttle'ının istek
saymasıdır; disk için yanlış birim budur. `0` kapatır. Diğer bütün limitlerle aynı istemci
IP'sine göre anahtarlanır, dolayısıyla proxy'nin arkasını görmesi için pakete dahil Compose
dosyasının zaten taşıdığı `TRUST_PROXY` ayarına ihtiyaç duyar; sayaçlar Redis'te yaşar, Redis
hata verdiği sürece süreç belleğine düşer. Bütçe aşımı, JSON gövdesi
`error: "Upload Budget Exceeded"` ve `Retry-After` başlığı taşıyan bir `429`'dur
([api-conventions.md](api-conventions.md#rate-limiting)).

**Onun dışında hiçbir şey siz sınırlamadıkça sınırlı değil.** Dört değişken, bayt yerine
_miktarlara_ tavan koyuyor ([ADR 0032](decisions/0032-plan-limits.md)), ve dördü de
`.env.example`'da ayarsız: `PLAN_MAX_SEATS_PER_WORKSPACE`, `PLAN_MAX_BOARDS_PER_WORKSPACE`,
`PLAN_MAX_WORKSPACES` ve `PLAN_MAX_USERS`. **Ayarlanmamış, sınırsız demek**, ve bu bloğa hiç
dokunmayan bir instance'ın çalıştırdığı şey de bu: hiç sayım sorgusu atılmaz. Yazılı bir `0` da
sınırsız demek; negatif ya da tam sayı olmayan bir değer açılışta reddedilir, ve geçerli sayılar
başlangıçta loglanır (`Plan ceilings: …`). Attachment kotalarının aksine bunların hiç varsayılanı
yok, ve bu bilerek: dolu bir disk veritabanını kendisiyle birlikte düşürür, onuncu bir board ise
bir satıra mal olur. Paketlenmiş `docker-compose.yml` dördünü de `api` container'ına iletir;
kendi compose dosyanız da aynısını yapmak zorunda, çünkü container `.env`'i kendisi asla okumaz.

Bir **seat**, bir üye _ya da_ hâlâ kabul edilmeyi bekleyen bir davettir, dolayısıyla tavandaki bir
admin kabulleri onun ötesine kuyruğa alamaz; bir daveti iptal etmek o seat'i anında boşaltır, ve
süresi dolan bir davet kendini boşaltır. `PLAN_MAX_USERS` yalnızca **sign-up'ı** reddeder, hiçbir
zaman sign-in'i değil, dolayısıyla onu zaten sahip olduğunuz hesap sayısının altına ayarlamak
kimseyi kilitlemez. Tavanı aşan bir yazma, JSON gövdesi `error: "Plan Limit Exceeded"` taşıyan bir
`403` ve kodu (`PLAN_LIMIT_SEATS`, `PLAN_LIMIT_BOARDS`, `PLAN_LIMIT_WORKSPACES`,
`PLAN_LIMIT_USERS`), limiti ve güncel sayımı taşıyan bir `planLimit` objesidir. Bir workspace'e
`Workspace.planLimits` JSON kolonunda kendine ait tavanlar verilebilir, ki bu, bunları anahtar
anahtar override eder; uygulama onu asla kendisi yazmaz.

**Trello import'u için de burada bir satır gerekmiyor.** `TRELLO_IMPORT_MAX_BYTES` (varsayılan
`20971520`, 20 MiB) importer'ın kabul edeceği en büyük board export'udur ve pakete dahil Compose
dosyası onu zaten geçiriyor. Dokunmadan önce bilmeye değer üç şey var. Bu bir **bellek** tavanıdır,
disk tavanı değil: yükleme belleğe alınıp `JSON.parse` ediliyor ve ayrıştırılmış nesne grafiği onu
üreten baytların birkaç katı oluyor — yani bunu yükseltmek API'nin tepe heap kullanımını farkın
kendisi kadar değil, farkın katı kadar yükseltir. `ATTACHMENT_MAX_BYTES` **ile ilgisi yoktur**;
ikinci bir değişken olmasının, birincisinin yeniden kullanılmamasının sebebi budur. Ve multipart
zarfına yer bırakacak şekilde **proxy'nin gövde limitinin altında** kalmak zorundadır (pakete dahil
`docker/Caddyfile`'da 26 MiB) — attachment limitiyle tam olarak aynı sebepten; bkz.
[aşağıdaki proxy sözleşmesi](#kendi-reverse-proxynizi-kullanmak). Import, `STORAGE_PATH`'in hiç
ayarlanmadığı bir instance'ta da çalışır: import bağlantı attachment'ları yaratır, onlar da bayt
saklamaz.

## 3. Başlatın

```bash
docker compose pull
docker compose up -d
docker compose ps -a     # "doğru" görüntünün nasıl olduğu aşağıda
```

Düz `ps` değil `ps -a`: `migrate` tek seferlik bir iştir ve siz bakana kadar çoktan çıkmıştır;
düz `ps` yalnızca çalışan container'ları listelediği için tam da kontrol etmek isteyeceğiniz
satırı atlar. Sağlıklı bir stack şöyle görünür:

```
api        Up 27 seconds (healthy)
backup     Up 28 seconds (health: starting)
migrate    Exited (0) 27 seconds ago
postgres   Up 34 seconds (healthy)
proxy      Up 16 seconds
redis      Up 34 seconds (healthy)
web        Up 22 seconds (healthy)
```

`migrate` satırındaki `Exited (0)` başarı demektir — migration'lar uygulandı, iş bitti. Peşine
düşülmesi gereken, sıfırdan farklı bir çıkış kodudur (`docker compose logs migrate`); o durumda
`api` zaten hiç başlamamış olur. `proxy` yanında `(healthy)` hiç yazmaz, çünkü hiç healthcheck
tanımlamaz. `backup` bir healthcheck tanımlar — `/backups` içinde taze bir dump arar — ama
`start_period`'ı geniştir (10 dakika), yani ilk `pg_dump`'ını henüz alan bir veritabanı
unhealthy değil `(health: starting)` görünür; zaman tanıyıp `docker compose ps backup` ile
tekrar bakın.

`https://kurul.example.com` adresine ilk istek, Caddy ACME doğrulamasını tamamlarken birkaç
saniye sürebilir. Sürmezse olan biteni izleyin:

```bash
docker compose logs -f proxy
```

Siteyi açın, ilk hesabı oluşturun ve bir workspace açın. İlk hesap sıradan bir hesaptır —
Kurul'un ayrı bir kurulum sihirbazı veya admin bootstrap adımı yoktur.

## 4. Gerçekten çalıştığını doğrulayın

```bash
curl -sI https://kurul.example.com | head -1          # 307 → /login
curl -s  https://kurul.example.com/api/health/ready   # {"status":"ok", …}
```

Sonra tarayıcıda bir pano açıp bir kartı sürükleyin. Kart, ikinci bir tarayıcı penceresinde
yenileme olmadan yer değiştiriyorsa realtime WebSocket proxy üzerinden bağlanmış demektir —
ki bu, naif bir reverse-proxy yapılandırmasının sessizce bozduğu tek parçadır.

Son olarak, HTTPS'in asıl amacı olan şeyi kontrol edin. Giriş yapın ve dönen çereze bakın:

```bash
curl -si https://kurul.example.com/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"siz@example.com","password":"<parolanız>"}' | grep -i '^set-cookie'
```

Adın ön ekli, niteliğin yerinde olmasını istiyorsunuz:

```
set-cookie: __Secure-better-auth.session_token=…; Path=/; HttpOnly; Secure; SameSite=Lax
```

`Secure`, tarayıcının o token'ı düz HTTP üzerinden **göndermeyi** reddedeceği; `__Secure-` ise
bağlantı HTTPS değilse çerezi **kabul etmeyi bile** reddedeceği anlamına gelir. İkisi de elle
açtığınız bir ayar değildir: Better Auth her ikisini de kendisine verilen URL'in şemasından
türetir, `docker-compose.yml` de o URL'i `SITE_URL`'den alır. Yani `SITE_URL`'deki şema, oturum
token'larının aktarım sırasında korunup korunmadığına karar veren tek anahtardır —
`SITE_URL=http://…` ile aynı istek `set-cookie: better-auth.session_token=…; HttpOnly;
SameSite=Lax` döner; ön ek de yok, `Secure` de yok ve oturum token'ı her istekte ağdan açık
metin olarak geçer. HTTPS olduğunu düşündüğünüz bir domain'de ön eksiz biçimi görüyorsanız
`SITE_URL` hâlâ `http://` ile başlıyordur; düzeltip `docker compose up -d` çalıştırın.

### API'yi bir script'ten çağırmak

Bir script, bir CI işi ya da bir yedek kontrolü cookie ile uğraşmak istemez. Ayarlar'ı açın,
"Kişisel erişim anahtarları" altında bir anahtar oluşturun, kopyalayın (yalnızca bir kez
gösterilir) ve oluşturulduğu workspace'e karşı Bearer başlığı olarak gönderin:

```bash
curl -s https://kurul.example.com/api/workspaces/<workspaceId>/boards \
  -H 'Authorization: Bearer kurul_pat_...'
```

Anahtar o tek workspace'te, istek geldiği andaki rolünüzle sizin yerinize işlem yapar; aynı
ekrandan iptal etmek onu anında durdurur ve workspace aktivite akışı hem oluşturmayı hem
iptali kaydeder. Neyi çağırıp neyi çağıramayacağı ve nedeni
[api-conventions.md](api-conventions.md#kimlik-doğrulama) içinde. HTTPS argümanı burada iki
kat geçerli: anahtar her istekte ağdan geçer, bu yüzden `http://` bir `SITE_URL`'e karşı asla
kullanmayın.

## 5. Üzerine bir monitör koyun

Bu, dağıtımın isteğe bağlı bir eki değil, bir adımıdır; en sona kalmasının nedeni, izleyecek
ayakta bir örneğe ihtiyaç duyan ilk adım olmasıdır. `restart: unless-stopped` çöken bir
container'ı geri getirir; bu stack'te hiçbir şey size host'un kapandığını, diskin dolduğunu veya
Postgres'in bağlantı kabul etmeyi bıraktığını söylemez. Harici bir monitör, izlediği makineden
sağ çıkan tek sinyaldir.

Şu URL'i izleyin:

```
https://kurul.example.com/api/health/ready
```

Bu URL'de yanlış yapılması kolay iki ayrıntı var ve ikisi de sessizce başarısız olur.

**`/api` ön eki zorunludur.** Onsuz `/health/ready` API değildir — proxy'nin catch-all kuralına
düşer ve web uygulamasına varır; o da `307` verip `/login`'e yönlendirir. Böyle
yapılandırılmış bir monitör, sapasağlam bir örnekte sonsuza dek kırmızıdır — gürültüyü kesmek
için kabul edilen durum kodlarını genişletirseniz bu kez bir kesinti sırasında da dahil olmak
üzere sonsuza dek yeşil olur.

**`/health` değil `/health/ready`.** `/health` bir liveness probe'udur: Node ayakta olduğu
sürece `200` döner, veritabanına ulaşılamadığı süre de buna dahildir — çünkü süreci yeniden
başlatmak bir veritabanını iyileştiremez. Ürünün gerçekten bozulduğunda kırmızıya dönen
`/health/ready`'dir ve gövdesi hangi bağımlılığın düştüğünü adıyla söyler:

```json
{ "status": "error", "checks": { "database": "down", "redis": "up" } }
```

Parametrelerin tamamı — 5 dakikalık aralık, alarmdan önce 2 ardışık başarısızlık, yalnızca
`200` kabul, 10 saniyelik timeout, "geri geldi" bildirimi açık bir e-posta kontağı —
[Uptime izleme](development.md#uptime-izleme--kesintiyi-asıl-yakalayan-bu-kurun)
bölümünde; internetten erişilemeyen bir örnek için push tabanlı alternatif de orada.

**Yedek tazeliğini de izleyin — `/api/health/ready` bunu kapsamaz.** `backup` sidecar'ı,
API'nin readiness probe'unun kontrol ettiği veritabanı bağlantısına hiç dokunmadan dump
üretmeyi durdurabilir (sürekli başarısız olan bir `pg_dump`, dolan bir volume) — o zaman bu
endpoint kesintinin tamamı boyunca yeşil kalır. Bunun yerine sinyal, `backup`'ın kendi Docker
healthcheck'idir: unhealthy, `/backups/kurul-*.dump` içindeki en yeni dosyanın
`2 × BACKUP_INTERVAL`'dan (varsayılan 24 saatlik aralıkta 48 saat) daha eski olduğu anlamına
gelir — bu da API'nin kendi retention süpürmesinin artık yakın zamanlı bir dump'a
güvenemeyeceği noktadır. Monitör aracınızın container-health kontrolünü (Docker'ı destekleyen
çoğu uptime aracı, ya da host üzerinde bir cron `docker inspect`) buna yönlendirin, ya da en
azından zaman zaman elle kontrol edin:

```bash
docker compose ps backup                                        # "(healthy)" veya "(unhealthy)"
docker inspect --format '{{.State.Health.Status}}' kurul-backup-1
```

`(unhealthy)` bir `backup`'ın yeniden başlatılmaya ihtiyacı yoktur — `restart: unless-stopped`
health durumuna göre hareket etmez, sidecar kendi kendine çalışmaya ve denemeye devam eder —
ihtiyacı olan şey `docker compose logs backup` okumaktır, çünkü gerçekten bir şey (genellikle
başarısız olan bir `pg_dump`) yanlış gitmiştir ve düzeltilmediği sürece bir sonraki
zamanlanmış döngü aynı sorunu devralır.

Sonra bilerek bir kez tetikleyin, çünkü hiç ateşlenmemiş bir alarm kurulumu bir güvence değil
bir varsayımdır:

```bash
docker compose stop postgres
curl -s https://kurul.example.com/api/health/ready   # 503, "database":"down"
# iki aralık bekleyin, kırmızı alarmı bekleyin
docker compose start postgres
curl -s https://kurul.example.com/api/health/ready   # 200, "database":"up"
# kurtarma e-postasını bekleyin
```

O pencerede `/health/ready`'nin `503`, `/health`'in `200` dönmesi hatalı değil doğru
davranıştır — iki endpoint'in var olma nedeni tam da bu farkı ifade etmektir.

## E-posta (SMTP)

SMTP olmadan sert biçimde bozulan tek özellik davetlerdir: bir daveti kabul etmek doğrulanmış
bir e-posta adresi gerektirir, doğrulama da iletilmiş bir mesaj
([ADR 0013](decisions/0013-invitation-email-verification.md)). `SMTP_HOST` boşken API yine
açılır ve mesajı göndermek yerine log'a yazar; yani tek kişilik kurulum sorunsuz çalışır — ama
kimse workspace'inize katılamaz. Üyeler ekranı bunu üründe de söyler. Bildirim e-postaları
(atama, mention, due-soon) aynı ayarları kullanır ve onlar olmadan yalnızca kapalı kalır; SMTP
çalıştığında her kullanıcı bunları Ayarlar'dan kendisi için kapatabilir.

Her SMTP sağlayıcısı çalışır. En sık iki şey ters gider:

- **`SMTP_SECURE`.** `true`, yalnızca 465 portunda geçerli olan implicit TLS demektir. 587 ve
  25 portları STARTTLS kullanır ve `false` ister. 587'de `true` bağlantıyı askıda bırakır.
- **`MAIL_FROM`, sağlayıcının adınıza göndermenize izin verdiği bir adres olmalı.** Çoğu
  sağlayıcı, kimliği doğrulanmış hesapla veya doğrulanmış domain'le eşleşmeyen bir `From:`
  başlığını reddeder; bu reddediliş arayüzde bir hata gibi değil, "davetler hiçbir şey
  yapmıyor" gibi görünür.

Test olarak kendinize bir davet gönderin. Hiçbir şey gelmiyorsa:

```bash
docker compose logs api | grep -i mail
```

## Yedekler

`backup` servisi zaten çalışıyor: her `BACKUP_INTERVAL` saniyede bir (varsayılan 24 saat)
`backup_data` volume'üne **iki** arşiv yazar — veritabanının `pg_dump`'ı ve yüklenmiş attachment
dosyalarının `.tar.gz`'i — ve her seriden `BACKUP_KEEP` tanesini tutar. Bir döngünün iki arşivi
de **aynı zaman damgasını** taşır; bir restore hangi tar'ın hangi dump'a ait olduğunu böyle
bilir.

Bu, "yanlış workspace'i sildim" durumunu karşılar. Ölen bir diski karşılamaz — arşivler
veritabanıyla aynı makinede durur. Onları makine dışına kopyalayın — yalnız dump'ı değil, **en
yeni döngünün iki yarısını da**:

```bash
docker run --rm -v kurul_backup_data:/backups -v "$PWD:/out" alpine \
  sh -c 'stamp=$(ls -t /backups/*.dump | head -1 | sed "s|.*/kurul-||;s|\.dump$||"); \
         cp /backups/kurul-$stamp.dump /out/; \
         cp /backups/kurul-$stamp-files.tar.gz /out/ 2>/dev/null || true'
```

Dosya arşivi olmadan geri yüklenen bir dump bütün satırları geri getirir ve yüklenmiş her
dosyayı geride bırakır — üstelik attachment'lardan önce yazılmış her doğrulama adımından geçer.
[Yedekten geri dönme](development.md#yedekten-geri-dönme) tatbikatı dosyaları da kontrol eder.

Geri yükleme adımları: [Yükseltme ve yedekleme](development.md#yükseltme-ve-yedekleme).

### Host dışı kopyalar

O komutu çalıştırmayı hatırlamaktan daha iyisi: sidecar'a bir remote verin, iki arşivi de her
döngüde kendisi itsin. `.env` içindeki `BACKUP_REMOTE`'a bir [rclone](https://rclone.org/)
remote yolu yazın; her döngü bundan sonra çifti yükler, remote'u aynı `BACKUP_KEEP` sayısına
budar ve bunun başarıldığını kaydeder. **`BACKUP_REMOTE` boş kaldığında hiçbir şey değişmez**,
healthcheck dahil: bu tamamen isteğe bağlıdır ve hiç ayarlamayan bir kurulum yukarıda anlatılan
döngüyü aynen çalıştırır.

| Değişken                       | Varsayılan | Amaç                                                                                             |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| `BACKUP_REMOTE`                | boş        | rclone remote yolu, örn. `s3:my-bucket/kurul`. Boş değer host dışı yarıyı tümüyle kapatır        |
| `RCLONE_CONFIG_<AD>_<ANAHTAR>` | -          | rclone'un kendi env değişkeni yapılandırması, `docker-compose.yml` yanındaki `rclone.env` içinde |
| `RCLONE_CONFIG`                | -          | Kimlik bilgilerini env yerine dosyada tutmak isterseniz, mount edilmiş `rclone.conf`'un yolu     |

Kimlik bilgileri `.env`'e **girmez**: rclone'un env anahtarları remote'un adına göre adlandığı
için `docker-compose.yml` içinde sabit bir liste tanımlanamaz, bu yüzden `backup` servisi
compose dosyasının yanındaki isteğe bağlı `rclone.env` dosyasını okur. O dosyayı yalnızca bu
container okur. `.env`'i de hiçbir container okumaz: Compose onu `${VAR}` enterpolasyonu için
kullanır ve her servise açık bir anahtar listesi iletir. API'nin okuduğu her ayar için o liste,
[`docker-compose.yml`](../../docker-compose.yml) içindeki `api` servisinin `environment:`
bloğudur; o blokta olmayan bir anahtar `.env`'de nasıl ayarlanırsa ayarlansın API'ye ulaşmaz.
`rclone.env`'i `chmod 600` ile oluşturun ve git'e sokmayın (`.gitignore` zaten listeliyor).

Uçtan uca bir S3 örneği. `KURULOFF` keyfi bir remote adıdır, yalnızca `BACKUP_REMOTE`
içindekiyle aynı olması gerekir:

```bash
# rclone.env, docker-compose.yml'nin yanında, chmod 600
RCLONE_CONFIG_KURULOFF_TYPE=s3
RCLONE_CONFIG_KURULOFF_PROVIDER=AWS
RCLONE_CONFIG_KURULOFF_ACCESS_KEY_ID=AKIA...
RCLONE_CONFIG_KURULOFF_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_KURULOFF_REGION=eu-central-1
```

```bash
# .env
BACKUP_REMOTE=KURULOFF:my-backup-bucket/kurul
```

```bash
docker compose up -d backup
docker compose logs backup | grep off-host    # arşiv başına "pushed kurul-… to KURULOFF:…"
```

rclone'un konuştuğu her hedef aynı iki satırla çalışır: Backblaze B2 (`_TYPE=b2`), MinIO ve
Cloudflare R2 dahil S3 uyumlu her endpoint (`_TYPE=s3` artı `_ENDPOINT=`), SFTP (`_TYPE=sftp`)
ve diğerleri. Anahtar adları [rclone dokümanındaki](https://rclone.org/docs/#config-file)
config anahtarlarının büyük harflisidir. Bunun yerine bir `rclone.conf` kullanacaksanız dosyayı
mount edip `RCLONE_CONFIG`'i ona yöneltin (iki satır da `docker-compose.override.yml` içinde
olsun ki `docker-compose.yml`'yi değiştiren bir upgrade onları silmesin):

```yaml
services:
  backup:
    volumes:
      - ./rclone.conf:/config/rclone.conf:ro
    environment:
      RCLONE_CONFIG: /config/rclone.conf
```

**rclone ilk kullanımda indirilir.** Sidecar stok bir `postgres:18-alpine` imajı çalıştırır,
bu yüzden `BACKUP_REMOTE` ayarlıyken script sabitlenmiş bir rclone sürümünü indirir (yaklaşık
20 MB, açılmış hâli 78 MB), `scripts/backup.sh` içine gömülü sha256 ile doğrular ve sonraki
döngülerle yeniden başlatmalar tekrar kullansın diye yedek volume'ünde saklar. Container'ın
`PATH`'inde zaten bir `rclone` varsa (kendi imajınız, mount edilmiş bir binary) o kullanılır ve
hiçbir şey indirilmez; internete kapalı bir host'un cevabı da budur.

**Healthcheck remote'u takip eder.** `BACKUP_REMOTE` ayarlıyken `docker compose ps` bu servisi
yalnızca en yeni **host dışı** kopya `2 × BACKUP_INTERVAL`'dan gençken healthy raporlar; süresi
dolmuş kimlik bilgileri, değişmiş bir bucket policy'si veya salıdan beri kopuk bir ağ, restore
gününde sürpriz olmak yerine unhealthy bir container olarak görünür. Yerel arşivler bu sırada
yazılmaya ve saklanmaya devam eder: başarısız bir yükleme hiçbirini silmez ve logdaki
`ERROR off-host:` satırı neyin başarısız olduğunu söyler.

**Remote'tan restore** için önce çifti yedek volume'üne geri çekin, sonra olağan
[restore tatbikatını](development.md#yedekten-geri-dönme) hiç değiştirmeden uygulayın; iki
kopyanın byte olarak aynı olmasının anlamı da budur:

```bash
docker compose exec backup /backups/.rclone/rclone --config= \
  lsf "$BACKUP_REMOTE"                 # bir zaman damgası seçin, iki yarısını da
docker compose exec backup /backups/.rclone/rclone --config= \
  copy "$BACKUP_REMOTE/kurul-<zaman damgası>.dump" /backups/
docker compose exec backup /backups/.rclone/rclone --config= \
  copy "$BACKUP_REMOTE/kurul-<zaman damgası>-files.tar.gz" /backups/
```

`/backups/.rclone/rclone` indirilen kopyadır; kendi rclone'unuzu verdiyseniz o yalnızca
`rclone` olur ve kimlik bilgileriniz mount edilmiş bir `rclone.conf`'ta yaşıyorsa
("yapılandırma yalnızca env değişkenleri" demek olan) `--config=` kalkar.

Host'un kendisi gittiyse o iki `copy` komutunu rclone'u ve aynı kimlik bilgilerini taşıyan
herhangi bir makinede çalıştırın ve arşivleri taze bir kurulumun restore adımına verin.

## Demo instance

Bu bölüm tek bir iş için: herkesin giriş yapabildiği ve içeriğini belirli aralıklarla çöpe atan
bir **herkese açık demo** çalıştırmak. Kurul'u kendi ekibiniz için barındırıyorsanız burayı
atlayın. Buradaki hiçbir şey varsayılan olarak açık değil ve hiçbiri sıradan bir kurulumu
değiştirmiyor: `.env.example` `DEMO_MODE` ve `DEMO_PASSWORD`'ü boş gönderir ve boş olan zaten
sıradan kurulumdur. Profile olmadan `docker compose up -d` ne sidecar'ı başlatır ne de bu iki
değerden birini ister.

Bir demoyu iki şey oluşturur: API'nin davranışını değiştiren `DEMO_MODE=true` ve silme işini
yapan sidecar'ı başlatan `demo` compose profile'ı. Ya ikisi birden, ya hiçbiri.

```bash
# .env
DEMO_MODE=true
DEMO_PASSWORD=birsey-secin-ve-yayinlayin      # en az 8 karakter
DEMO_RESET_INTERVAL_MINUTES=60                # varsayılan
POSTGRES_DB=kurul_demo                        # aşağıdaki "iki kilit" bölümüne bakın
REDIS_PASSWORD=...                            # önerilir, aşağıya bakın
```

```bash
docker compose --profile demo up -d
```

Profile tek bir container ekler: `demo-reset`. API ile aynı `kurul-api` imajından çalışır, yani
ayrıca build edilecek veya çekilecek bir şey yok.

### `DEMO_MODE=true` neyi değiştirir

| Davranış                                               | Neden                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Uygulamada sıklığı söyleyen kalıcı bir bildirim şeridi | Bir ziyaretçinin, bir saatlik emeğinin silineceğine dair aldığı tek uyarı budur. Sekme boyunca kapatılabilir, sonraki ziyarette geri gelir     |
| Giden tüm e-posta log'a yazılır                        | `SMTP_HOST` ne derse desin. Herkesin kayıt olabildiği bir demo, bir yabancının yazdığı adrese posta gönderebiliyor olmamalı                    |
| Hesap silme ve workspace silme `403` döner             | Demo tek bir paylaşılan workspace'tir. Onu ya da sahibi hesabı silmek, bir sonraki reset'e kadar demoyu diğer bütün ziyaretçiler için boşaltır |
| `GET /config` reset takvimini yayınlar                 | Böylece bildirim şeridi, sidecar'ın gerçekten uyuduğu süreyi söyler; iki kez yazılmış bir sayıyı değil                                         |

Geri kalan her şey ürünün kendisidir. Kayıt açık kalır (oradaki kötüye kullanımın cevabı bir
anahtar değil, rate limit'tir), davetler yine oluşturulabilir ve bağlantıları elle
kopyalanabilir, yüklemeler ise olağan attachment kotalarıyla sınırlıdır
([ADR 0027](decisions/0027-attachment-quotas.md)). Bir demo host'ta başka bir anahtara uzanmak
yerine bu kotaları düşük tutun.

### Hesap

Reset tek bir hesap oluşturur: `demo@kurul.dev`, şifresi `DEMO_PASSWORD`'e yazdığınız değer.
Demo bağlantısını nerede yayınlıyorsanız ikisini de orada yayınlayın. Varsayılan bir şifre yok
ve olmayacak: açık kaynak bir imaja gömülü varsayılan, internetteki her demo host'unda aynı
şifre demektir. Yanında dataset, **hiçbir kimlik bilgisi olmayan** ikinci bir kişi de yaratır:
board'larda yorum ve atamaların hepsi ziyaretçinin kendisine ait olmasın diye vardır ve sızacak
bir şifresi yoktur.

### Reset'in üzerindeki iki kilit

`node dist/demo/reset.js` bir şey yazmadan önce veritabanındaki her satırı siler. **İkisi
birden** doğru değilse çalışmayı reddeder:

1. Kendi ortamında `DEMO_MODE=true` ayarlı olmalı ve
2. `DATABASE_URL`'in işaret ettiği veritabanının adında `demo` geçmeli.

Yukarıdaki örnekte `POSTGRES_DB=kurul_demo` bu yüzden var. İki farklı kaynaktan gelen iki
bağımsız kontrol; böylece bunu gerçek bir kuruluma çevirmek bir değil iki hata gerektirir.
`kurul`, `kurul_prod` ve `postgres` reddedilir.

### Oturumlar ve reset'ten sonraki bir dakika

Reset her oturumu siler, yani giriş yapmış herkesin oturumu kapanır. Uygulama bunu karşılar:
sonraki gezinme, bulunduğunuz sayfa dönüş adresi olarak korunarak giriş ekranına düşer.

Reset'ten sonraki 60 saniyeye kadar, oturumu açık olan bir tarayıcı imzalı oturum çerezinden
tanınmaya devam edebilir; Kurul her istekte bir veritabanı okuması yapmamak için bu çerezi o
kadar süre önbellekler. Bu aralıkta okumalar boş döner ve bir yazma başarısız olabilir. Kendi
kendine geçer, silinmiş bir hesabın da aynı aralığı vardır
([ADR 0026](decisions/0026-account-deletion-anonymisation.md)) ve bir demoda bedeli, birinin
saati dolarken son bir dakikada yazdığı şeydir.

### İzleme

Asıl kontrol `docker compose ps`. Aralığın iki katı boyunca başarılı bir reset olmazsa
`demo-reset` **unhealthy** raporlar; yani üst üste iki kaçırılmış döngü, yani yavaş ya da
atlanmış tek bir çalıştırma onu oynatmaz. Bu olmasa, reset üretmeyi bırakmış bir döngü sadece "Up"
görünürken lansman günü bağlantısı son ziyaretçinin bıraktığı şeyi servis ederdi.

```bash
docker compose --profile demo logs demo-reset
```

Ayrıca `https://alan-adiniz/api/health/ready` adresine bir uptime monitörü koyun;
[5. Üzerine bir monitör koyun](#5-üzerine-bir-monitör-koyun) bölümüne bakın. Bu, her kurulumun
aldığı aynı tavsiye ve demonun düştüğünü internetteki birinden önce size söyleyen şey.

### Herkese açık bir demoda ayrıca yapılması iyi olanlar

- **`REDIS_PASSWORD` ayarlayın.** Redis compose ağının dışına açılmadığı için başka her yerde
  isteğe bağlı. Yabancıların yönlendirildiği bir host, bu tek satırlık ek savunmanın değdiği
  yerdir.
- **Attachment kotalarını düşük tutun.** `ATTACHMENT_WORKSPACE_QUOTA_BYTES` ve
  `ATTACHMENT_INSTANCE_QUOTA_BYTES`, iki reset arasında bir demoya ne kadar veri
  depolatılabileceğini sınırlar; reset satırları siler, gecelik süpürme baytları geri kazanır.
- **İçine gerçek hiçbir şey koymayın.** Burası bir staging ortamı değil. Boşaltmak üzere
  tasarlanmış bir container tarafından her saat boşaltılan bir veritabanı.

## Upgrade

Bir release imajlar artı dosyalardır. `docker compose pull` imajları yeniler, başka hiçbir şeyi
değil; dolayısıyla yalnızca pull yapan bir kurulum, kurulduğu günkü `docker-compose.yml`,
`docker/Caddyfile` ve `scripts/backup.sh` ile çalışmaya devam eder ve sonraki her release'in
eklediği servis (`demo` profilinin `demo-reset`'i), compose'un ilettiği değişken
(`BACKUP_REMOTE`, attachment kotaları) ya da Caddy kuralı ona sessizce ulaşmaz. Runbook
dosyaları bu yüzden yeniden indirir. Adımları her seferinde bu sırayla yapın; hiçbiri uzun
değil.

1. **Release'i okuyun.** Hedef sürümün [CHANGELOG](../../CHANGELOG.md) bölümü her kırıcı
   değişikliği ve her migration notunu taşır; aşağıdaki
   [Operatörler için sürüm notları](#operatörler-için-sürüm-notları) ise `pull`'dan önce sizden
   bir şey isteyenleri gösterir.
2. **Şimdi bir yedek alın ve host dışına kopyalayın.** Sidecar'ın son döngüsü bir gün eski
   olabilir; bu, upgrade'in hemen öncesinden ve bir rollback'in isteyeceği kurtarma noktası tam
   olarak bu:

   ```bash
   docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
   ```

   Sonra çifti [Yedekler](#yedekler) bölümündeki komutla volume'den dışarı kopyalayın ya da
   `BACKUP_REMOTE` ayarlıysa `docker compose logs backup` içindeki iki `off-host: pushed`
   satırını doğrulayın. Neden iki yarısı da gerekli ve `docker compose down -v`'den sağ çıkan
   elle alınan varyant: [Elle dump almak](development.md#elle-dump-almak).

3. **Dosyaları yeni tag'den yeniden indirin.**
   [Kurulumun 2. adımındaki](#2-compose-dosyasını-indirin-ve-yapılandırın) `curl` satırlarını
   her URL'de yeni sürümle yeniden çalıştırın, `.env` olanı hariç: `.env` sizindir ve kalır.
   Diğer üç dosya olduğu gibi değiştirilir; yerel bir değişikliğin dosyaların kendisine değil
   `.env`'e ya da bir `docker-compose.override.yml`'e ait olmasının nedeni bu
   ([`rclone.conf` mount'u](#host-dışı-kopyalar) ve
   [`TRUST_PROXY`](#kendi-reverse-proxynizi-kullanmak) zaten öyle yapıyor). Release'in neyi
   değiştirdiğini çalışmadan önce görmek isterseniz yeni compose dosyasını eskisiyle
   `diff`'leyin.
4. **`TAG`'i** `.env`'de yeni sürüme ayarlayın, URL'lerdekiyle aynı string.
5. **Pull ve başlatma:**

   ```bash
   docker compose pull
   docker compose up -d --wait
   ```

   Migration'lar otomatik çalışır: tek seferlik `migrate` servisi onları `api` başlamadan önce
   uygular ve `--wait`, uzun süreli her servis healthy raporladığında döner, biri raporlamazsa
   sıfırdan farklı kodla.

6. **Doğrulayın:**

   ```bash
   docker compose ps -a                          # migrate: Exited (0); gerisi healthy
   curl -fsS https://kurul.example.com/api/health/ready
   ```

   `-a`, yoksa tek seferlik `migrate` satırı gizlenir. Sonra siteyi açıp bir kez giriş yapın.

7. **Ters giderse:** [Geri alma (rollback)](development.md#geri-alma-rollback) imajları önceki
   tag'e geri almayı ve bunun tek başına ne zaman yettiğini anlatır;
   [Yedekten geri dönme](development.md#yedekten-geri-dönme) ise 2. adımda aldığınız arşivin
   tatbikatı. İkisi de bilerek burada tekrarlanmıyor: adımlar, ters giden bir upgrade de olsa
   başka bir şey de olsa aynı.

`latest`'i takip etmek yerine `.env`'de `TAG=v0.3.0` ile bir sürümü sabitleyin: upgrade, 2.
adımdaki yedek elinizdeyken bilinçli attığınız bir adım olmalı, bir sonraki
`docker compose up`'ın size yaptığı bir şey değil.

### Operatörler için sürüm notları

Bir release'in bu sayfanın indirttiği dosyalarda neyi değiştirdiği ya da `pull`'dan önce
sizden ne beklediği. Girdilerin tamamı `CHANGELOG.md`'de; bu liste yalnızca onları gösterir.

- **Sonraki release ([Unreleased](../../CHANGELOG.md#unreleased)):** Better Auth 1.7.1,
  `migrate` servisinin ilk `up`'ta uyguladığı bir migration getiriyor; çalıştırılacak bir şey
  yok, ama onu karşılayan 2. adımdaki yedek. `BACKUP_REMOTE` ve host dışı kopya, 3. adımdaki
  `scripts/backup.sh` ve `docker-compose.yml`'i gerektirir (v0.3.0'ın script'i değişkeni hata
  vermeden yok sayar); kurulumu [Host dışı kopyalar](#host-dışı-kopyalar) bölümünde.
  `TRUST_PROXY` artık `.env`'den, varsayılanı `1` olarak okunuyor: daha eski bir
  `.env.example`'ın `.env`'inizde bıraktığı `TRUST_PROXY=false` satırını silin, yoksa Caddy
  arkasındaki API istemci adreslerini görmeyi bırakır
  ([ayrıntı](#kendi-reverse-proxynizi-kullanmak)).
- **0.3.0 ([CHANGELOG](../../CHANGELOG.md#030---2026-08-22)):** attachment kotalarına
  varsayılan geldi; upgrade'den önce kullanımınızı kontrol edin, bkz. aşağıdaki
  [Attachment kotalarının artık varsayılanı var](#attachment-kotalarının-artık-varsayılanı-var).
  Ayrıca `kurul-migrate`'i yayınlayan ilk sürüm, yani bu sayfadaki `curl` kurulumunun çalıştığı
  ilk sürüm.

### Attachment kotalarının artık varsayılanı var

`v0.3.0` ve sonrası, `ATTACHMENT_WORKSPACE_QUOTA_BYTES` / `ATTACHMENT_INSTANCE_QUOTA_BYTES`
ayarlanmadığında attachment depolamasını workspace başına 2 GiB, instance başına 20 GiB ile
sınırlar (eskiden sınırsız demekti). **Halihazırda 2 GiB'den fazla dosya tutan bir workspace,
bir sonraki yüklemesinde `413` alır**; bunu istemiyorsanız upgrade'den önce daha yüksek bir sayı
ya da sınırsız için `0` yazın. Nerede durduğunuzu tek sorgu söyler; ilki instance'ın, ikincisi
workspace başına toplam:

```bash
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT COALESCE(SUM(size), 0) AS instance_bytes FROM \"Attachment\" WHERE kind = 'FILE';"
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT w.slug, SUM(a.size) AS bytes FROM \"Attachment\" a JOIN \"Task\" t ON t.id = a.\"taskId\" JOIN \"Board\" b ON b.id = t.\"boardId\" JOIN \"Workspace\" w ON w.id = b.\"workspaceId\" WHERE a.kind = 'FILE' GROUP BY w.slug ORDER BY bytes DESC;"
```

Sayıları `2147483648` ve `21474836480` ile karşılaştırın. Aynı upgrade, IP başına bir yükleme
bayt bütçesi de getiriyor (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, varsayılan dakikada 256 MiB);
bu yalnızca tek adresten dakikada ondan fazla tam boy dosya yükleyen bir istemciyi ilgilendirir.

### Kurultay'dan geliyorsanız (v0.1.0)

Proje v0.2.0 öncesinde yeniden adlandırıldı ve bu, README'deki etiketten fazlasına dokunuyor:
Postgres rolü ve veritabanı artık `kurul`, yayınlanan imajlar `ghcr.io/dravcore/kurul-api` ve
`-web`, ve Compose volume önekini kurulum dizininden türettiği için yukarıdaki talimatların
`/opt/kurul` demesi de bir fark yaratıyor. Mevcut bir v0.1.0 kurulumu bunların hiçbirini
kendiliğinden almaz; eski imaj adlarına `docker compose pull` demek size eskisini vermeye devam
eder.

**Çalışan bir veritabanını sizin yerinize yeniden adlandıran bir yükseltme yolu yok.** Şu sırayla,
stack kapalıyken yapın ve önce yedeği alın — bu, projenin geçmişinde şemaya değil **kimliklere**
dokunan tek yükseltmedir.

```bash
cd /opt/kurultay
docker compose exec postgres pg_dump -U kurultay -Fc kurultay > /tmp/kurul-migration.dump
docker compose down                     # -v DEĞİL: volume'ler zaten koruduğunuz şey
```

Sonra dizini yeniden adlandırın ve release'in dosyalarını, geçtiğiniz tag'den,
[kurulumun 2. adımındaki](#2-compose-dosyasını-indirin-ve-yapılandırın) `curl` satırlarıyla
alın (`.env` olanı hariç; sizinki kalır):

```bash
cd /opt && mv kurultay kurul && cd kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/v0.3.0/docker-compose.yml
# sonra docker/Caddyfile ve scripts/backup.sh de aynı şekilde
```

`.env`'i düzenleyin: `POSTGRES_USER` ve `POSTGRES_DB` `kurul` olur, `DATABASE_URL`'in kimlik ve
veritabanı bölümleri de onlarla birlikte değişir. Ardından koruduğunuz volume üzerinde yeni rolü
ve veritabanını yaratıp restore edin:

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U kurultay -d kurultay   -c "CREATE ROLE kurul LOGIN PASSWORD '<POSTGRES_PASSWORD değeriniz>';"   -c 'CREATE DATABASE kurul OWNER kurul;'
docker compose exec -T postgres pg_restore -U kurul -d kurul --no-owner < /tmp/kurul-migration.dump
docker compose up -d
curl -s https://alan.adiniz/api/health/ready
```

Eski rol ve veritabanı, yeni stack bir gün gerçek trafik gördükten sonra düşürülebilir. Dump'ı o
zamana kadar saklayın; yeniden adlandırma öncesine ait tek kopya odur.

**Volume'leri taşıyan şey dizinin yeniden adlandırılmasıdır**, çünkü Compose onları proje adıyla
isimlendirir — `kurultay_postgres_data`, `kurul_postgres_data` olur. Taşımak istemiyorsanız
`.env`'e `COMPOSE_PROJECT_NAME=kurultay` yazın, eski volume'ler eski adlarıyla kullanılmaya devam
eder. İkisi de desteklenir ve ikincisi biraz kafa karıştırıcıdır; yeter ki bilinçli seçin.

## Çektiğiniz imajı doğrulamak

`docker compose pull`, ghcr.io ne verirse ona güvenir. Her sürümle birlikte yayınlanan iki şey
bunu bırakmanızı sağlar: bu imajın bu deponun release workflow'undan çıktığını söyleyen bir
**imza** ve içinde ne olduğunu söyleyen bir **SBOM**. İkisini de kullanmak isteğe bağlıdır ve
aşağıdaki komutları hiç çalıştırmayan kimseyi korumazlar.

### İmzayı kontrol etmek

[cosign](https://github.com/sigstore/cosign) **3.0 veya üstü** gerekir — imzalar cosign 3'ün
varsayılan olarak kullandığı Sigstore bundle formatında yazılır ve cosign 2 bunları okuyamaz.

```bash
cosign verify \
  --certificate-identity "https://github.com/dravcore/kurul/.github/workflows/release-images.yml@refs/tags/v0.3.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/dravcore/kurul-api:v0.3.0
```

Aynısını, aynı şekilde imzalanan `kurul-web` ve `kurul-migrate` için tekrarlayın; başka bir
sürümü doğrularken `v0.3.0`'ı iki yerde de değiştirin. Sürüm iki kez geçiyor çünkü iki farklı şeyi
anlatıyor: biri imzalayan workflow'un
üzerinde çalıştığı git ref'i, diğeri sorduğunuz imaj tag'i.

**Bütün kontrol bu iki `--certificate-*` bayrağıdır; onları atmayın.** Burada korunacak bir
imzalama anahtarı yok. İmajlar keyless imzalanır: release workflow'u bir GitHub OIDC token'ını
birkaç dakika geçerli bir sertifikayla takas eder, imzalar, sertifika sona erer. Sonucu anlamlı
kılan bir sırrın saklanmış olması değil, sertifikanın _hangi depodaki hangi workflow'un hangi
git ref'inde_ bunu istediğini kaydetmesidir. `--certificate-identity` olmadan cosign, geçerli
imzalanmış herhangi birinin imajını seve seve kabul eder — bu deponun kendi fork'una tag atmış
birininkini de.

Başarılı bir çalıştırma yaptığı kontrolleri ve doğruladığı digest'i içeren bir JSON iddiası
yazdırır:

```
Verification for ghcr.io/dravcore/kurul-api:v0.3.0 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The code-signing certificate was verified using trusted certificate authority certificates
```

Bunun dışındaki her şey bir hatadır ve birbirinden ayırmaya değer iki hata şunlar: `no
signatures found` (bu imaj hiç imzalanmamış — bu özellikten eski, ya da sandığınız imaj değil)
ve `no matching CertificateIdentity found` (imzalanmış, ama sorduğunuz kimlikten başka biri ya
da başka bir şey tarafından; hata mesajı bulduğu kimliği yazdırır).

Doğrulama, güven kökü ve transparency log için Sigstore'un genel altyapısına çıkar, yani dışarı
HTTPS ister. Sunucunun interneti yoksa deploy etmeden önce kendi makinenizden çalıştırın.

Son argüman olarak hem tag hem digest çalışır; imajı çoktan çekmiş bir makinede digest daha
katı soruyu sorar — tag'in şu anda neyi gösterdiğini değil, diskteki baytları sorar:

```bash
docker image inspect ghcr.io/dravcore/kurul-api:v0.3.0 --format '{{index .RepoDigests 0}}'
```

### SBOM nerede

Sürümün [GitHub Release](https://github.com/dravcore/kurul/releases) sayfasında, indirilebilir
asset olarak — imaj başına ve mimari başına bir tane, çünkü iki mimari gerçekten aynı paketleri
içermiyor:

```
kurul-api-v0.3.0-linux-amd64.spdx.json
kurul-api-v0.3.0-linux-arm64.spdx.json
kurul-web-v0.3.0-linux-amd64.spdx.json
kurul-web-v0.3.0-linux-arm64.spdx.json
kurul-migrate-v0.3.0-linux-amd64.spdx.json
kurul-migrate-v0.3.0-linux-arm64.spdx.json
```

Format SPDX 2.3 JSON; `grype`, `trivy` ve Dependency-Track'in üçü de dönüştürmeden okur:

```bash
gh release download v0.3.0 --repo dravcore/kurul --pattern '*.spdx.json'
grype sbom:./kurul-api-v0.3.0-linux-amd64.spdx.json
```

**SBOM dosyasının kendisi imzalı değildir** — yukarıdaki imza imajı kapsar, SBOM ise aynı
workflow çalıştırmasının ürettiği bir tarifidir. Çoğu kişi için bu yeterlidir, çünkü kurcalanmış
bir SBOM kurcalanmış bir imajı doğrulatamaz. Daha güçlü garantiye ihtiyacınız varsa dosyaya
güvenmeyin: zaten doğruladığınız imajdan [syft](https://github.com/anchore/syft) ile kendiniz
yeniden üretip karşılaştırın.

```bash
syft scan registry:ghcr.io/dravcore/kurul-api:v0.3.0 --platform linux/amd64 -o spdx-json
```

## Kendi reverse proxy'nizi kullanmak

Zaten nginx, Traefik veya başka bir proxy çalıştırıyorsanız ve üstüne ikincisini koymak
istemiyorsanız `proxy` servisini değiştirebilirsiniz — ancak yönlendirme sözleşmesi pazarlığa
açık değildir, çünkü web uygulaması ona göre build edilir. Tek hostname altında, bu sırayla üç
kural:

| Yol            | Nereye   | Prefix                | Azami istek gövdesi          |
| -------------- | -------- | --------------------- | ---------------------------- |
| `/auth/*`      | api:4000 | olduğu gibi korunur   | **64 KiB** (`65536` bayt)    |
| `/api/*`       | api:4000 | `/api` **kaldırılır** | **26 MiB** (`27262976` bayt) |
| geri kalan her | web:3000 | olduğu gibi korunur   | proxy varsayılanı yeterli    |

`/api/*` ayrıca WebSocket upgrade'lerini de geçirmelidir — realtime pano akışı odur.

#### Proxy'nin sayısı neden 26 MiB, API'ninki neden 25

**Bu bir yazım hatası değil ve ikisi eşitlenmemeli.** Bu instance'ın kabul ettiği en büyük _ek_
`ATTACHMENT_MAX_BYTES`, yani 25 MiB — kullanıcıya söylenecek sayı budur ve limiti değiştirmek
istediğinizde değiştireceğiniz tek sayı da budur. Proxy'nin 26 MiB'ı onun **üstünde** bir
tavandır, ikinci bir kopyası değil.

Farklı olmalarının sebebi farklı şeyleri saymaları. `client_max_body_size` (ve Caddy'nin
`request_body max_size`'ı) **istek gövdesinin tamamını** sayar; `ATTACHMENT_MAX_BYTES` ise
içindeki **dosyayı** sayar. Bir yükleme dosyayı multipart bir zarfa sarar — her parça için bir
boundary satırı ve bir `Content-Disposition` header'ı, artı kapanış boundary'si — ve bu zarf
dosyanın kendi baytlarının **üstüne** biner. Bu API'nin aldığı gerçek istek üzerinde ölçüldü:
kısa bir dosya adı için 309 bayt, 255 karakterlik bir ad için 563 bayt.

Yani proxy tam 25 MiB'a ayarlanırsa 25 MiB'lık bir ek yüklenemez: dosya belgelenen limitin
içindedir, gövde değildir. Kullanıcı, belgelerin izinli dediği bir dosyada `413` alır ve
bakması söylenen sayı, sorun olmayan sayıdır.

İki katmanın gerçekte izlediği kural eşitlik değil, bir sıralamadır:

> **Proxy, API'nin kabul edeceği bir şeyi asla reddetmemeli.** Proxy'nin işi absürt gövdeleri
> herhangi bir yerde tamponlanmadan önce kesmektir. Kesin dosya limiti API'ye aittir — hangi
> dosyanın büyük olduğunu cevabında söyleyebilen tek katman odur.

**Aynı proxy'den ikinci bir gövde daha geçiyor: Trello import'u.** `TRELLO_IMPORT_MAX_BYTES`
(20 MiB) aynı sıralama kuralına ve aynı 26 MiB'lık proxy tavanına tabi; daha küçük bir sayı olduğu
için payı da daha fazla. Ama ikisi arasında kontrol edilen ilişki bir **eşitsizliktir**, attachment
limitinin tabi olduğu "eşitlik artı zarf" değil — import limitinin yalnızca proxy'ninkinin altında
kalması gerekir, onu takip etmesi değil. Yani `TRELLO_IMPORT_MAX_BYTES`'ı proxy'nin sayısının
üstüne çıkarmak, proxy'nin API'nin hiç görmediği boş gövdeli bir `413` ile kestiği bir import
üretir. İlişkilerden biri bozulursa build'i düşüren dosya:
`apps/api/src/storage/two-layer-limit.spec.ts`.

Dolayısıyla: `ATTACHMENT_MAX_BYTES`'ı yükseltirseniz proxy'nin sayısını da onun üstünde kalacak
şekilde yükseltmelisiniz (pakete dahil yapılandırma 1 MiB pay bırakıyor; bu, ölçülen en büyük
zarfın ~1860 katı). Proxy'ninkini API'ninkinin altına indirirseniz limite yakın her yükleme,
API'nin hiç görmediği ve hiç loglamadığı bir `413` ile düşer. Caddy kendi başına gövde limiti
koymaz — pakete dahil `docker/Caddyfile`'ın limiti açıkça yazmasının sebebi budur — ve nginx
`client_max_body_size` için **1 MB** varsayar; yani satırı atlayan bir yedek proxy, bir
megabayttan büyük her eki reddeder.

#### `/auth/*` neden kendi tavanına sahip ve neden 64 KiB

Kural 1 de bir limit taşır, hem de çok daha küçüğünü. Better Auth ham istek akışını kendisi
okur; diğer bütün rotalarda `REQUEST_BODY_MAX_BYTES`'ı uygulayan parser'ların altındadır,
dolayısıyla o tavan `/auth/*` için hiç geçerli olmadı: bir `POST /auth/sign-in/email` hangi
boyutta olursa olsun sonuna kadar okunuyordu ve yerleşik deneme bütçesi (sign-in, sign-up ve
change-password'de IP ve yol başına 10 saniyede 3, diğer auth rotalarında dakikada 100) baytı
değil isteği sayar. Bu rotaların aldığı her gövde birkaç yüz baytlık bir JSON nesnesidir; 64 KiB
bunun iki büyüklük mertebesi üstünde bir pay bırakır.

API aynı sayıyı `AUTH_BODY_MAX_BYTES` olarak uygular (`65536`; bir ortam değişkeni değil,
`apps/api/src/auth/auth-body-limit.ts` içindeki bir sabit): bunun üstünde bir `Content-Length`
bildiren istek, gövdesinden tek bayt okunmadan `Request body is too large` yazan `413` zarfıyla
cevaplanır. Burada proxy ile API, yukarıdaki çiftin aksine, **eşit olabilir**: bir auth
gövdesinin multipart zarfı yoktur, iki katman aynı baytları sayar ve sıralama kuralı eşitlikte de
geçerlidir.

`Content-Length` olmadan gönderilen bir gövde (chunked transfer encoding; bir tarayıcı JSON
gövdesi için bunu hiç kullanmaz) iki katmanın farklı cevapladığı tek durumdur. Onu bir status
koduyla sınırlayan katman proxy'dir: `request_body max_size` gövdeyi aynı 64 KiB'ta keser. API,
Better Auth'a akıtmakta olduğu bir gövdeye cevap veremez; bu yüzden baytları geldikçe sayar ve
tavan aşılınca bağlantıyı kapatır. Bu, proxy'siz açığa çıkarılmış bir instance'ı da sınırlı
tutar, ama `413` yerine kopan bir bağlantıyla. Proxy'nin isteğe bağlı bir ek değil, varsayılan
stack'in parçası olmasının bir sebebi daha budur. `apps/api/src/storage/two-layer-limit.spec.ts`
Caddyfile'daki sayıyı, aşağıdaki nginx satırını ve API sabitini birbirine sabitler.

### 413'leri birbirinden ayırmak

Her iki katman da boyutu aşan bir yüklemeye `413` ile cevap verir — ve yüklemelerle hiç ilgisi
olmayan üçüncü bir limit de öyle. **Hangisinin reddettiğini cevap gövdesi söyler**:

| Aldığınız cevap                                    | Reddeden | Anlamı                                                            |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `statusCode` taşıyan **JSON** gövdeli `413`        | API      | tasarlandığı gibi — dosya `ATTACHMENT_MAX_BYTES`'ı aşıyor         |
| **Boş** gövdeli `413` (`Content-Length: 0`)        | proxy    | gövde proxy'nin tavanını aştı; bu kaba kesim                      |
| `Request body is too large` yazan JSON `413`       | API      | yükleme bile değil — `REQUEST_BODY_MAX_BYTES`'ı aşan JSON gövde   |
| `error: "Attachment Quota Exceeded"` taşıyan `413` | API      | dosya sığıyor, depolama sığmıyor — bir kota dolu (yukarıya bakın) |

Birinci satır, boyutu aşan bir ek için normal cevaptır ve kullanıcının bir şey yapabileceği
cevaptır: limiti adlandırır. İkincisi, proxy'nin gövdeyi API hiç görmeden reddetmesidir —
absürt bir şey için doğrudur, ama kullanıcı bunu `ATTACHMENT_MAX_BYTES`'ın **altındaki** bir
dosyada alıyorsa proxy tavanınız çok düşüktür (yukarıdaki "Proxy'nin sayısı neden 26 MiB,
API'ninki neden 25" bölümüne bakın).

Üçüncü satır, aynı status kodunu paylaşan başka bir limittir: `REQUEST_BODY_MAX_BYTES`
(varsayılan `1048576`, 1 MiB) diğer bütün uçların aldığı **JSON ve form-encoded** gövdeleri
sınırlar ve hiçbir attachment oradan geçmez. Aynı cümle `/auth/` ile başlayan bir `path` altında
geliyorsa limit, daha küçük olan `AUTH_BODY_MAX_BYTES`'tır (64 KiB); yukarıdaki kural 1'e bakın.
İkisinden birini görüyorsanız ne storage'ınızda ne proxy'nizde yanlış bir şey var; bir istek
yalnızca API'nin kabul ettiğinden fazla JSON göndermiştir.

Dördüncü satır ise başka bir başarısızlıktır: dosya `ATTACHMENT_MAX_BYTES`'ın altındadır, ama onu
saklamak bir workspace'i ya da instance'ı kendi kotasının üzerine çıkarır. Boyutlandırma için
yukarıdaki "Attachment depolaması siz sınırlamadıkça sınırsızdır ve Postgres'in diskini paylaşır"
bölümüne bakın: `ATTACHMENT_WORKSPACE_QUOTA_BYTES` ve `ATTACHMENT_INSTANCE_QUOTA_BYTES`.

Bir beşincisi daha var ve onu yalnızca tek bir uç üretebilir:
`POST /workspaces/…/imports/trello` üzerindeki bir `413`, yukarıdaki dördünden hiçbiri değil,
`TRELLO_IMPORT_MAX_BYTES`'tır (20 MiB). Ayırt eden şey cevap zarfındaki `path` alanıdır. Kullanıcı
bunu 20 MiB'ın **altındaki** bir export'ta alıyorsa gövdeyi önce proxy kesmiştir ve bakılacak tavan
proxy'ninkidir.

Header'lar yardımcı olmaz — Caddy'nin `413`'ü `Server` header'ı taşımaz; ikisini yalnız gövde
ayırır. API'nin kendi reddettiği her şey
`Content-Type: application/json; charset=utf-8` ile ve
`{"statusCode":…,"error":…,"path":…,"requestId":…}` zarfıyla döner; proxy'nin reddi ise hiç gövde
taşımaz.

**Proxy bu reddi loglamaz.** `docker/Caddyfile`'da `log` direktifi yoktur — API zaten kendisine
ulaşan her isteği logluyor ve her iki katmanda access log tutmak tek bir boyut kontrolü uğruna
her deployment'ın log hacmini ikiye katlardı — dolayısıyla proxy'nin reddettiği bir gövde
`docker compose logs proxy` çıktısında **hiç görünmez**. Proxy logunda hiçbir şey yokken gelen
boş gövdeli bir `413`, limitin bozuk olduğunun değil, beklenen sonucun kendisidir.

`docker/Caddyfile` üzerinde `caddy:2-alpine` ile, o zamanki limitiyle (`25MiB`) ölçüldü: tam
`26214400` bayt gövde → `200`, bir bayt fazlası → `413`, ve `curl` düzgün bir durum satırıyla
`0` koduyla çıkıyor — bağlantı yükleme ortasında kesilmiyor, usulünce kapanıyor. Eşiğin `>=`
değil `> max_size` olduğunu kuran ölçüm budur; limitin taşınması gerektiğini gösteren de aynı
ölçüm: 26214400 baytlık bir _dosya_ bundan birkaç yüz bayt büyük bir gövde üretiyor. Pakete
dahil yapılandırma artık `26MiB` diyor ve bu ölçümün sınırı da onunla birlikte kayıyor.

Bunu kendiniz denerseniz **gerçek bir yükleme ucuna** yöneltin. Rastgele bir yola atmak hiçbir
şey ölçmez: API, header'ları alır almaz gövdeyi hiç okumadan `404` cevaplar, istek proxy'nin
limitine ulaşmadan biter ve limit yokmuş gibi görünen bir `404` alırsınız.

İki API kuralı bilinçli olarak farklıdır. Better Auth, mount yolunu kendisine verilen URL'den
türetir ve gelen istekleri ona göre eşleştirir; dolayısıyla `/auth` sunucuda, tarayıcıda ve
gönderdiği doğrulama linklerinde aynı dize olmak zorundadır. API'nin geri kalanı kendi kökünde
mount edilmiştir ve prefix girişte kaldırılır. nginx'te:

```nginx
location /auth/ {
  proxy_pass http://api:4000;                      # sondaki slash yok → yol korunur
  client_max_body_size 64k;                        # AUTH_BODY_MAX_BYTES'a (64 KiB) EŞİT: auth
                                                   # gövdesinin multipart zarfı yok, iki katman
                                                   # aynı baytları sayar.
}
location /api/  {
  proxy_pass http://api:4000/;                     # sondaki slash var → /api kaldırılır
  client_max_body_size 26m;                        # ATTACHMENT_MAX_BYTES'ın (25 MiB) ÜSTÜNDE,
                                                   # eşiti değil — multipart zarfı dosyanın
                                                   # üstüne biner. Yukarıdaki bölüme bakın.
}
location /      { proxy_pass http://web:3000;  }
```

Proxy'niz Kurul'un kendi `proxy` servisini değiştirmek yerine onun önünde duruyorsa,
`.env`'de `TRUST_PROXY`'yi hop sayısına ayarlayın (Caddy'nin önündeki bir CDN bunu `2` yapar).
`docker-compose.yml` bu değişkeni `api` servisine varsayılanı `1` olarak iletir; yani boş ya da
hiç olmayan bir satır tek hop durumudur ve değer, her [upgrade](#upgrade)'in yaptığı compose
dosyası yeniden indirmesinden sağ çıkar. İki hop arkasında `1`'de bırakılırsa tüm rate-limit
kovaları ve access log'daki tüm IP'ler dıştaki proxy'nizin adresine çöker. `false` yazılırsa
(compose satırı iletmeden önceki eski bir `.env.example`'ın gönderdiği değer) aynı şey tek hop
arkasında da olur; böyle bir satırı bırakmak yerine silin.

## Neden yeniden build gerekmiyor

Next.js, `NEXT_PUBLIC_*` değişkenlerini build zamanında gönderdiği JavaScript'in içine derler.
Bu nedenle mutlak bir `NEXT_PUBLIC_API_URL`, web imajını tek bir dağıtıma özgü hale getirir ve
"imajı çek, env'i ver" modeli çalışamaz — Kurul'un eskiden tam olarak dayattığı şey buydu
([denetim bulgusu PM-02](https://github.com/dravcore/kurul/issues/119)).

Bir `NEXT_PUBLIC_*` değeri hâlâ gömülü, çünkü yerine gömülecek her yerde doğru bir değer yok:
tarayıcı Sentry DSN'i. Bunun pull ile kurulmuş bir instance için ne anlama geldiğini aşağıdaki
[Tarayıcı hata takibi](#tarayıcı-hata-takibi) anlatıyor.

Çözüm değeri gömülmekten çıkarmak değil, zaten her yerde doğru olan bir değeri gömmek.
Yayınlanan imaj `NEXT_PUBLIC_API_URL=/api` taşır; bu, sayfanın sunulduğu origin üzerinde bir
yoldur ve `kurul.example.com`'da da `boards.acme.internal`'da da doğrudur. Bu ancak reverse
proxy her iki uygulamayı tek origin'e koyduğu için geçerlidir — `proxy`'nin isteğe bağlı bir
ek değil, varsayılan stack'in parçası olmasının nedeni budur.

Sunucu tarafı render bir yolu kullanamaz — Node içinde onu çözecek bir origin yoktur — bu
yüzden `INTERNAL_API_URL`'i okur; bu, docker-compose.yml'nin doğrudan container ağı üzerinden
`http://api:4000`'e yönlendirdiği sıradan bir çalışma zamanı değişkenidir.

API'yi gerçekten kendi hostname'inde isteyen bir dağıtım, web imajını mutlak bir URL ile yine
build edebilir:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

Bu imaj artık `api.example.com`'a özgüdür ve dağıtım başına yeniden build etmeye geri
dönersiniz — bu bir eksiklik değil, bilinçli takastır.

### Tarayıcı hata takibi

`NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` ve `NEXT_PUBLIC_SENTRY_RELEASE`, imaj
build edilirken web bundle'ının içine derlenir: `docker-compose.yml` bunları `environment:`
olarak değil `build.args` olarak geçer ve API URL'inin aksine gömülecek dağıtımdan bağımsız bir
değer yoktur, çünkü bir DSN tek bir Sentry projesini adlandırır. Release workflow'u
`ghcr.io/dravcore/kurul-web`'i üçü de boşken build eder ve boş, Sentry SDK'sının bundle'a hiç
girmemesi demektir. Dolayısıyla yayınlanan imaj tarayıcı hata takibi olmadan gelir ve bu
sayfanın anlattığı kurulumda `.env`'e yazılan bir `NEXT_PUBLIC_SENTRY_DSN` satırı hiçbir şeyi
değiştirmez, hiçbir log'da uyarı da vermez. API tarafı farklı: `SENTRY_DSN` container
başlarken okunan sıradan bir çalışma zamanı değişkenidir ve
[Hata takibi](development.md#hata-takibi-sentry--varsayılan-kapalı) bölümünün anlattığı gibi
`.env`'den çalışır.

Tarayıcı hata takibi bu yüzden web imajını kendiniz build etmek demektir; bunun için de `curl`
kurulumunun sahip olmadığı bir kaynak ağacı gerekir. `NEXT_PUBLIC_SENTRY_*` satırlarını
`.env`'inize yazın, çalıştırdığınız tag'i clone'layın ve sonucun kurulumunuzun çözdüğü `TAG`'i
taşıması için o `.env`'in bir kopyasından build edin:

```bash
git clone --branch v0.3.0 https://github.com/dravcore/kurul.git /opt/kurul-src
cp /opt/kurul/.env /opt/kurul-src/.env
cd /opt/kurul-src && docker compose build web      # ghcr.io/dravcore/kurul-web:<TAG> olarak etiketler
cd /opt/kurul && docker compose up -d web          # pull yok: az önce build edilen imajı kullanır
```

Compose dosyası olmadan aynı build, clone içinden
`docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SENTRY_DSN=https://... .`
komutudur. Her iki durumda da imaj tek bir Sentry projesine özgüdür ve bir sonraki
[upgrade](#upgrade)'in `docker compose pull`'u onu yayınlanan imajla değiştirir: her
upgrade'den sonra yeniden build edin, yoksa takip onunla birlikte durur. Kurulumun geri kalanı,
iki proje ve neyin gönderildiği:
[Hata takibi](development.md#hata-takibi-sentry--varsayılan-kapalı).

## Sorun giderme

**`docker compose pull` `denied` ile bitiyor.** İmajları, bir release tag'inde çalışan bir
workflow yayınlar; dolayısıyla her biri yalnızca kendisini ilk taşıyan sürümden itibaren var:
`api` ve `web` `v0.2.0`'dan, `kurul-migrate` ise `v0.3.0`'dan. Bu yüzden `v0.2.0`'da diğer
ikisi çözülse bile o tek imaj için pull başarısız olur ve `docker compose pull`, `postgres`,
`redis` ve `caddy`'yi başarıyla indirdikten sonra sıfırdan farklı bir kodla çıkar: yalnızca
çıkış koduna değil çıktının sonuna bakın, çünkü başarılı olanlar, olmayanları ekrandan yukarı
kaydırır. Daha yeni bir sürümde aynı belirti genellikle dosyalarla imajların uyuşmadığı
anlamına gelir: `main`'den ya da `TAG`'den daha yeni bir tag'den indirilmiş bir
`docker-compose.yml`, sabitlediğiniz sürümün hiç yayınlamadığı bir imajı ya da servisi
adlandırabilir; 2. adımın her dosyayı `TAG`'deki tag'den indirmesinin ve bir
[upgrade](#upgrade)'in onları yeniden indirmesinin nedeni bu. Doğru tag'den yeniden indirin ya
da çekmek yerine kaynaktan build edin:

```bash
git clone https://github.com/dravcore/kurul.git && cd kurul
docker compose up -d --build
```

Tek fark bunun daha yavaş olmasıdır — api imajı bir dakika kadar build alır.
`docker-compose.yml` üç servisin üçü için de bilinçli olarak hem `image:` hem `build:` taşır;
böylece aynı dosya, çözülebilen bir yayınlanmış imaj varsa ondan, yoksa kaynaktan kurar.

**Sertifika bir türlü alınmıyor.** 80 ve 443 portlarının ikisi de public internetten sunucuya
ulaşabilmeli ve DNS çoktan çözülüyor olmalı. `docker compose logs proxy` hatanın adını verir.
Let's Encrypt'in rate limit'ine (domain başına haftada 5 sertifika) takıldıysanız beklemekten
başka çare yok — `caddy_data` volume'ü tam olarak, yeniden başlatmanın zaten sahip olduğu bir
sertifikayı tekrar istememesi için var.

**Panolar yükleniyor ama kendi kendine güncellenmiyor.** WebSocket geçmiyor demektir. Pakete
dahil `proxy` ile bu yaşanmamalı; kendi proxy'nizle `/api/*` kuralınızın
`Upgrade`/`Connection` başlıklarını ilettiğinden emin olun.

**Domain'i değiştirdikten hemen sonra giriş başarısız.** `SITE_URL`, oturum çerezinin
kapsandığı origin'dir. Değiştirin, `docker compose up -d` çalıştırın (bu, `api`'yi yeni değerle
yeniden oluşturur) ve tekrar giriş yapın — eski çerez eski origin'e aittir.

**Her şey 502 veriyor.** `docker compose ps` çalıştırın. `api` unhealthy ise
`docker compose logs api`; en sık neden, `.env`'deki `POSTGRES_PASSWORD`'ün mevcut bir
`postgres_data` volume'üne gömülü olanla artık eşleşmemesidir — bkz.
[Veritabanı ve cache kimlik bilgileri](development.md#veritabanı-ve-cache-kimlik-bilgileri).
