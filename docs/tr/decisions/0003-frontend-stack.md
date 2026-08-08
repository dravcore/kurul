# 0003. Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0003-frontend-stack.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Frontend; interaktif bir kanban board'u (drag-and-drop ile yeniden sıralama), stillendirilmiş bir component sistemini ve grafikli bir dashboard'u render etmeli, aynı zamanda solo/küçük ekip kod tabanının bakımını yapabileceği kadar hafif kalmalı.

## Karar

**Next.js (App Router)** + **Tailwind CSS** + **shadcn/ui** + **@dnd-kit** + **Recharts**.

## Gerekçe

- `react-beautiful-dnd` deprecated — Atlassian bakımından çekildi, dolayısıyla yeni iş için uygulanabilir bir seçim değil.
- **@dnd-kit**, çoğu React drag-and-drop ihtiyacı için 2026'nın varsayılanı: küçük (6KB core), erişilebilir (klavye ve ekran okuyucu desteği), framework-agnostik ve aktif bakımda. Linear, issue sıralaması için `@dnd-kit`'in kendisini kullanıyor.
- Tipik kanban ölçeğinde (board başına 50–200 kart) `@dnd-kit` ile Atlassian'ın daha yeni `pragmatic-drag-and-drop`'u arasında ölçülebilir bir performans farkı yok. O kütüphane yalnızca 1000+ öğede öne geçiyor ve collision detection'ın elle yazılmasını gerektiriyor — henüz bu karmaşıklığa değmiyor.
- **Recharts**, çoğu React dashboard'u için en güvenli varsayılan: güçlü ekosistem benimsenmesi, anlaşılır bir component API'si, SVG rendering, shadcn/ui ile iyi uyum, MIT lisanslı. Bundle'ı (~290KB) en hafif seçenek değil; grafik sayısı veya veri seti boyutu önemli ölçüde büyürse Canvas tabanlı bir kütüphane (Chart.js, Apache ECharts) yeniden değerlendirilmeli.

## Sonuçlar

- Kendimiz klavye desteği inşa etmeden, kutudan çıktığı gibi erişilebilir drag-and-drop.
- Tailwind + shadcn/ui üzerinden tutarlı görsel dil, tek seferlik stillendirmeyi azaltıyor.
- Recharts'ın sade API'siyle dashboard'lar hızlıca yayına alınıyor.
- Board etkileşimleri daha karmaşıklaştıkça (nested sortable'lar, çok kolonlu drag) `@dnd-kit`'in collision detection'ı özel ayarlama gerektirebilir.
- Recharts'ın bundle ağırlığı analitik özellikler genişledikçe yeniden ele alınmalı — bu bir gözden kaçırma değil, bilinçli bir "sonra tekrar bak" trade-off'u.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| react-beautiful-dnd | Deprecated; Atlassian bakımından çekildi |
| pragmatic-drag-and-drop | Yalnızca 1000+ öğe ölçeğinde kazanıyor; elle yazılmış collision detection gerektiriyor — mevcut board boyutları için henüz erken |
| Chart.js / Apache ECharts | Canvas tabanlı, çok büyük veri setleri için daha iyi, ama entegrasyonu daha ağır ve şu an shadcn/ui ile daha az idiomatic |
