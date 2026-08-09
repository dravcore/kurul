# 0011. Label ve Task-Metadata İzinleri

**Durum:** Kabul edildi
**Tarih:** 2026-08-09

> 🌐 [English (canonical)](../../decisions/0011-label-task-metadata-permissions.md) | Türkçe

## Bağlam

Faz 5 board label'ları, assignee'ler, priority/due/estimate alanları ve yorumları ekler.
[ADR 0010](0010-task-permissions.md) MEMBER+'a task create/edit/move/delete verir. Label'lar
board-scoped taksonomidir (column gibi); kart düzenlemeden ayrı bir kapı gerekir.

## Karar

| İşlem                                                         | OWNER | ADMIN | MEMBER | GUEST |
| ------------------------------------------------------------- | :---: | :---: | :----: | :---: |
| Label, assignee, comment, task metadata okuma                 |   ✓   |   ✓   |   ✓    |   ✓   |
| Board label oluştur / yeniden adlandır / sil                  |   ✓   |   ✓   |   —    |   —   |
| Task'a label ata / kaldır                                     |   ✓   |   ✓   |   ✓    |   —   |
| Assignee ekle / kaldır                                        |   ✓   |   ✓   |   ✓    |   —   |
| `priority`, `dueDate`, `estimatedMinutes` güncelle            |   ✓   |   ✓   |   ✓    |   —   |
| Yorum oluştur; erişilebilir task'taki herhangi bir yorumu sil |   ✓   |   ✓   |   ✓    |   —   |

`Label.color` bir `LabelColorSlot` (`slot-1`…`slot-8`), asla ham hex değildir.

## Gerekçe

- Label CRUD board sözlüğünü değiştirir — column yapısıyla aynı Admin+ duruş
  ([ADR 0009](0009-board-column-permissions.md)).
- Label/kişi/tarih atamak günlük kart işidir — MEMBER+.
- Düz yorum silme MVP için authorship kontrolünden kaçınır.

## Sonuçlar

- Nest `@Roles` label CRUD ile label assign için ayrılır.
- Web: `canMutateLabels` (Admin+) vs `canMutateTasks` (MEMBER+).

## Alternatifler

| Alternatif                     | Neden değil                                         |
| ------------------------------ | --------------------------------------------------- |
| MEMBER label oluşturabilir     | Taksonomiyi kirletir; column Admin ile çelişir      |
| Yalnızca yazar yorum silebilir | Ekstra kontrol; kötüye kullanım çıkana kadar ertele |
