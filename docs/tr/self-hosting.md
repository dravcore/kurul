# Kurultay'ı kendi domain'inizde barındırma

Kurultay'ı bir sunucuya, kendi domain'inize, HTTPS ve çalışan e-posta ile kurun. Aşağıdakilerin
tamamı bilinçli olarak tek sayfa; çoğu DNS beklemekle geçen yaklaşık bir saat ayırın.

Build adımı yok. `docker compose pull` her sürüm için yayınlanan imajları indirir ve aynı imaj
her domain'de çalışır — API URL'i imajın içine derlenmiş değildir (gerekçesi için bkz.
[Neden yeniden build gerekmiyor](#neden-yeniden-build-gerekmiyor)).

## Gerekenler

- Public IP'si olan, Docker Engine 24+ ve Compose eklentisi kurulu bir sunucu. Küçük bir ekip
  için iki CPU ve 2 GB RAM yeterli.
- Kontrolünüzdeki bir domain ve o sunucuya **açık 80 ve 443 portları**. İkisi de zorunlu:
  Let's Encrypt doğrulamayı 80 üzerinden yapar, tarayıcılar 443'ü kullanır.
- Bir SMTP hesabı. Kurultay'da davetlerin kabul edilebilmesi için giden e-posta şart —
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

## 1. DNS

Hostname'i sunucunuza yönlendirin ve stack'i başlatmadan önce yayılmasını bekleyin — Caddy ilk
açılışta sertifika ister ve DNS henüz canlı olmadığı için başarısız olan bir istek Let's
Encrypt'in rate limit'ine sayılır.

```
kurultay.example.com.   A     203.0.113.10
kurultay.example.com.   AAAA  2001:db8::10      # yalnızca sunucunun IPv6'sı varsa
```

Sunucunun kendisi dışında bir yerden doğrulayın:

```bash
dig +short kurultay.example.com
```

## 2. Compose dosyasını indirin ve yapılandırın

```bash
mkdir -p /opt/kurultay && cd /opt/kurultay
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurultay/main/docker-compose.yml
curl -fsSL --create-dirs -o docker/Caddyfile \
  https://raw.githubusercontent.com/dravcore/kurultay/main/docker/Caddyfile
curl -fsSL -o .env https://raw.githubusercontent.com/dravcore/kurultay/main/.env.example
```

`.env`'i düzenleyin. Yalnızca Docker ile kurulumda önemli olan satırlar şunlar — dosyadaki geri
kalan her şey ya geliştirme döngüsü için ya da çalışan bir varsayılana sahip:

```bash
SITE_URL=https://kurultay.example.com          # domain'iniz, şema dahil

POSTGRES_PASSWORD=<openssl rand -hex 32>       # base64 değil hex — bir URL'in içine giriyor
BETTER_AUTH_SECRET=<openssl rand -hex 32>      # oturum imzalama anahtarı

SMTP_HOST=smtp.example.com                     # aşağıdaki "E-posta" bölümüne bakın
SMTP_PORT=587
SMTP_USER=kurultay@example.com
SMTP_PASSWORD=<smtp parolanız>
SMTP_SECURE=false                              # yalnızca 465 portu için true
MAIL_FROM=Kurultay <kurultay@example.com>
```

İki gizli değeri `openssl rand -hex 32` ile üretin. `-base64` değil `-hex`: base64 çıktısı `/`
içerebilir ve her iki değer de bir URL'in içine giriyor — orada bir slash URL'i keser.

`SITE_URL` şemayı taşır, çünkü Caddy'nin düz HTTP mi sunacağına yoksa sertifika mı alacağına
karar veren şey odur. `https://…` otomatik HTTPS'i açar. `http://localhost` (varsayılan) ise
domain'siz yerel kurulumdur.

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
backup     Up 28 seconds
migrate    Exited (0) 27 seconds ago
postgres   Up 34 seconds (healthy)
proxy      Up 16 seconds
redis      Up 34 seconds (healthy)
web        Up 22 seconds (healthy)
```

`migrate` satırındaki `Exited (0)` başarı demektir — migration'lar uygulandı, iş bitti. Peşine
düşülmesi gereken, sıfırdan farklı bir çıkış kodudur (`docker compose logs migrate`); o durumda
`api` zaten hiç başlamamış olur. `backup` ve `proxy` yanında `(healthy)` yazmaması, bir sorun
olduğu için değil, ikisinin de healthcheck tanımlamamış olmasındandır.

`https://kurultay.example.com` adresine ilk istek, Caddy ACME doğrulamasını tamamlarken birkaç
saniye sürebilir. Sürmezse olan biteni izleyin:

```bash
docker compose logs -f proxy
```

Siteyi açın, ilk hesabı oluşturun ve bir workspace açın. İlk hesap sıradan bir hesaptır —
Kurultay'ın ayrı bir kurulum sihirbazı veya admin bootstrap adımı yoktur.

## 4. Gerçekten çalıştığını doğrulayın

```bash
curl -sI https://kurultay.example.com | head -1          # 307 → /login
curl -s  https://kurultay.example.com/api/health/ready   # {"status":"ok", …}
```

Sonra tarayıcıda bir pano açıp bir kartı sürükleyin. Kart, ikinci bir tarayıcı penceresinde
yenileme olmadan yer değiştiriyorsa realtime WebSocket proxy üzerinden bağlanmış demektir —
ki bu, naif bir reverse-proxy yapılandırmasının sessizce bozduğu tek parçadır.

Son olarak, HTTPS'in asıl amacı olan şeyi kontrol edin. Giriş yapın ve dönen çereze bakın:

```bash
curl -si https://kurultay.example.com/auth/sign-in/email \
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

## 5. Üzerine bir monitör koyun

Bu, dağıtımın isteğe bağlı bir eki değil, bir adımıdır; en sona kalmasının nedeni, izleyecek
ayakta bir örneğe ihtiyaç duyan ilk adım olmasıdır. `restart: unless-stopped` çöken bir
container'ı geri getirir; bu stack'te hiçbir şey size host'un kapandığını, diskin dolduğunu veya
Postgres'in bağlantı kabul etmeyi bıraktığını söylemez. Harici bir monitör, izlediği makineden
sağ çıkan tek sinyaldir.

Şu URL'i izleyin:

```
https://kurultay.example.com/api/health/ready
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

Sonra bilerek bir kez tetikleyin, çünkü hiç ateşlenmemiş bir alarm kurulumu bir güvence değil
bir varsayımdır:

```bash
docker compose stop postgres
curl -s https://kurultay.example.com/api/health/ready   # 503, "database":"down"
# iki aralık bekleyin, kırmızı alarmı bekleyin
docker compose start postgres
curl -s https://kurultay.example.com/api/health/ready   # 200, "database":"up"
# kurtarma e-postasını bekleyin
```

O pencerede `/health/ready`'nin `503`, `/health`'in `200` dönmesi hatalı değil doğru
davranıştır — iki endpoint'in var olma nedeni tam da bu farkı ifade etmektir.

## E-posta (SMTP)

SMTP olmadan sert biçimde bozulan tek özellik davetlerdir: bir daveti kabul etmek doğrulanmış
bir e-posta adresi gerektirir, doğrulama da iletilmiş bir mesaj
([ADR 0013](decisions/0013-invitation-email-verification.md)). `SMTP_HOST` boşken API yine
açılır ve mesajı göndermek yerine log'a yazar; yani tek kişilik kurulum sorunsuz çalışır — ama
kimse workspace'inize katılamaz. Üyeler ekranı bunu üründe de söyler.

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
`backup_data` volume'üne bir `pg_dump` arşivi yazar ve bunlardan `BACKUP_KEEP` tanesini tutar.

Bu, "yanlış workspace'i sildim" durumunu karşılar. Ölen bir diski karşılamaz — arşivler
veritabanıyla aynı makinede durur. Onları makine dışına kopyalayın:

```bash
docker run --rm -v kurultay_backup_data:/backups -v "$PWD:/out" alpine \
  sh -c 'cp /backups/$(ls -t /backups | head -1) /out/'
```

Geri yükleme adımları: [Yükseltme ve yedekleme](development.md#yükseltme-ve-yedekleme).

## Upgrade

```bash
docker compose pull && docker compose up -d
```

Migration'lar otomatik çalışır: tek seferlik `migrate` servisi, `api` başlamadan önce bekleyen
migration'ları uygular. `latest`'i takip etmek yerine bilinçli upgrade etmeyi tercih
ediyorsanız `.env`'de `TAG=v0.2.0` ile bir sürümü sabitleyin.

## Kendi reverse proxy'nizi kullanmak

Zaten nginx, Traefik veya başka bir proxy çalıştırıyorsanız ve üstüne ikincisini koymak
istemiyorsanız `proxy` servisini değiştirebilirsiniz — ancak yönlendirme sözleşmesi pazarlığa
açık değildir, çünkü web uygulaması ona göre build edilir. Tek hostname altında, bu sırayla üç
kural:

| Yol            | Nereye   | Prefix                |
| -------------- | -------- | --------------------- |
| `/auth/*`      | api:4000 | olduğu gibi korunur   |
| `/api/*`       | api:4000 | `/api` **kaldırılır** |
| geri kalan her | web:3000 | olduğu gibi korunur   |

`/api/*` ayrıca WebSocket upgrade'lerini de geçirmelidir — realtime pano akışı odur.

İki API kuralı bilinçli olarak farklıdır. Better Auth, mount yolunu kendisine verilen URL'den
türetir ve gelen istekleri ona göre eşleştirir; dolayısıyla `/auth` sunucuda, tarayıcıda ve
gönderdiği doğrulama linklerinde aynı dize olmak zorundadır. API'nin geri kalanı kendi kökünde
mount edilmiştir ve prefix girişte kaldırılır. nginx'te:

```nginx
location /auth/ { proxy_pass http://api:4000;  }   # sondaki slash yok → yol korunur
location /api/  { proxy_pass http://api:4000/; }   # sondaki slash var → /api kaldırılır
location /      { proxy_pass http://web:3000;  }
```

Proxy'niz Kurultay'ın kendi `proxy` servisini değiştirmek yerine onun önünde duruyorsa,
`docker-compose.yml`'deki `api` servisinin `TRUST_PROXY` değerini hop sayısına yükseltin
(Caddy'nin önündeki bir CDN bunu `2` yapar). `1`'de bırakılırsa tüm rate-limit kovaları ve
access log'daki tüm IP'ler dıştaki proxy'nizin adresine çöker.

## Neden yeniden build gerekmiyor

Next.js, `NEXT_PUBLIC_*` değişkenlerini build zamanında gönderdiği JavaScript'in içine derler.
Bu nedenle mutlak bir `NEXT_PUBLIC_API_URL`, web imajını tek bir dağıtıma özgü hale getirir ve
"imajı çek, env'i ver" modeli çalışamaz — Kurultay'ın eskiden tam olarak dayattığı şey buydu
([denetim bulgusu PM-02](https://github.com/dravcore/kurultay/issues/119)).

Çözüm değeri gömülmekten çıkarmak değil, zaten her yerde doğru olan bir değeri gömmek.
Yayınlanan imaj `NEXT_PUBLIC_API_URL=/api` taşır; bu, sayfanın sunulduğu origin üzerinde bir
yoldur ve `kurultay.example.com`'da da `boards.acme.internal`'da da doğrudur. Bu ancak reverse
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

## Sorun giderme

**`docker compose pull` `denied` ile bitiyor.** `api` ve `web` imajlarını, bir release tag'inde
çalışan bir workflow yayınlar; dolayısıyla `v0.2.0` ve sonrası için varlar, daha eskisi için
yoklar. Bunlardan önceki bir sürümdeyken iki sonuç doğar. `docker compose pull`, `postgres`,
`redis` ve `caddy`'yi başarıyla indirdikten sonra sıfırdan farklı bir kodla çıkar — yalnızca
çıkış koduna değil çıktının sonuna bakın, çünkü başarılı olan üçü, olmayan ikisini ekrandan
yukarı kaydırır. Bir de 2. adımda indirdiğiniz dosyalar `main` dalından gelir ve `main` yalnızca
en son release'in taşıdığını taşır: `docker-compose.yml` içinde `proxy:` servisi yoksa ve
indirilecek bir `docker/Caddyfile` yoksa release'in ilerisindesiniz demektir ve bu rehberdeki
HTTPS'in hiçbiri az önce indirdiğiniz şey için geçerli değildir. Ya release'i bekleyin ya da
çekmek yerine kaynaktan build edin:

```bash
git clone https://github.com/dravcore/kurultay.git && cd kurultay
docker compose up -d --build
```

Tek fark bunun daha yavaş olmasıdır — api imajı bir dakika kadar build alır.
`docker-compose.yml` her iki servis için bilinçli olarak hem `image:` hem `build:` taşır; böylece
aynı dosya, çözülebilen bir yayınlanmış imaj varsa ondan, yoksa kaynaktan kurar.

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
