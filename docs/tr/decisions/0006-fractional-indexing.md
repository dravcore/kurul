# 0006. Task ve Column Pozisyonu için Fractional Indexing

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0006-fractional-indexing.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kanban kartları ve kolonları drag-and-drop ile sürekli yeniden sıralanıyor. Naif bir integer position kolonu, iki mevcut kart arasına bir kart eklendiğinde sonraki her satırın yeniden numaralanmasını gerektiriyor, bu da her drag-and-drop hareketini bir O(n) yazmaya ve board'lar büyüdükçe bir lock contention kaynağına dönüştürüyor.

## Karar

`Task.position` ve `Column.position`, asla `Int` değil, **`Float`**.

## Gerekçe

- Bir kartı `1` ve `2` pozisyonları arasına eklemek, yeni/taşınan satıra `1.5` pozisyonunu atıyor. Yalnızca o tek satır yazılıyor — hiçbir sibling satıra dokunulmuyor.
- Kart ve kolon yeniden sıralaması, bir kanban aracının temel etkileşim yüzeyi ve liste uzunluğundan bağımsız olarak anında hissettirmesi gerekiyor; integer yeniden numaralamanın başaramadığını, tek satırlık bir yazma başarıyor.
- Bu bir stil tercihi değil, sert bir gereklilik — bunu sonradan tersine çevirmek, mevcut her board üzerinde bir veri migration'ı anlamına gelir.

## Sonuçlar

- Bir kartı taşımak, kolon boyutundan bağımsız tek-satırlık bir veritabanı yazması — O(n) yeniden numaralama yok, taşınan liste boyunca lock contention yok.
- Aynı iki komşu arasına tekrarlanan eklemeler (örn. yoğun bir kolonun en üstüne her zaman yeni bir kart bırakmak), zaman içinde pozisyon değerlerini giderek daha ince ondalık hassasiyete sürükleyebilir.
- Floating-point hassasiyeti sonludur: aşırı ekleme derinliğinde, bir kolonun pozisyonlarını yuvarlak, iyi aralıklı sayılara geri akıtmak için periyodik bir rebalancing job'ı sonunda gerekebilir. Bu, bir tasarım eksikliği değil, kabul edilmiş, ertelenmiş bir trade-off — yalnızca olağan kullanımın hızlıca ulaşması pek olası olmayan derinliklerde önem kazanıyor.
- `position` üzerindeki eşitlik/sıralama karşılaştırmaları, sorgularda ve ORM katmanında float karşılaştırma uç durumlarını hesaba katmalı.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| Yeniden numaralamalı integer pozisyon | Her hareket, ekleme noktasından sonraki her satırı günceller — O(n) yazma ve eşzamanlı çok-kullanıcılı drag-and-drop altında race condition'lar |
| String tabanlı fractional indexing (örn. base62 order key'leri) | Float hassasiyet sınırlarından tamamen kaçınıyor, ama henüz gerekçelendirilmemiş key-üretim karmaşıklığı ekliyor; float rebalancing gerçek bir operasyonel soruna dönüşürse yeniden değerlendirmeye değer |
