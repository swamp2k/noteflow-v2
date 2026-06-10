# Displaying NoteFlow tasks in KWGT

This guide shows how to display your NoteFlow tasks on an Android home-screen widget built with
**KWGT** (Kustom Widget Maker), as an alternative to the bundled `noteflow-widget` app. Both
consume the same public endpoint — `GET /api/widget/tasks` — so no extra backend is needed.

KWGT gives you full control over the look (fonts, colors, layout) but requires manual per-row
setup and the Pro key. The bundled widget is zero-config but fixed in appearance.

---

## Prerequisites

1. **KWGT** installed, plus the **KWGT Pro Key** — network access via the `wg()` function is a
   Pro-only feature. Without it the widget cannot fetch from the API.
2. A **widget token**. In the NoteFlow PWA go to **Settings → Android Widget** and generate one
   (this calls `POST /api/widget/token`). Copy the full token — it is shown only once.

---

## The endpoint

```
https://noteflow-api.jeppesen.cc/api/widget/tasks?token=<TOKEN>&tzoffset=<MINUTES>
```

- **`token`** (required) — your widget token. Auth is entirely via this query param; **no headers
  are needed** (important, because KWGT's `wg()` cannot send an `Authorization` header).
- **`tzoffset`** (optional) — minutes to add to UTC to reach your local calendar day, so the
  `today` / `tomorrow` / `overdue` labels are correct. The worker runs in UTC; without this they
  can slip by a day near midnight. Examples: CET = `60`, CEST = `120`, US Eastern (EST) = `-300`.

> This path has a Cloudflare Access **Bypass** policy, so it returns JSON (not an Access login
> page). If you ever get an HTML/parse error, the bypass policy is missing on the host you called.

### Response shape

```json
{
  "tasks": [
    {
      "id": "abc123",
      "title": "Buy milk",
      "due_at": 1749686400000,
      "subject": "Errands",
      "due_label": "tomorrow",
      "overdue": false
    }
  ]
}
```

| Field       | Type            | Notes                                                                 |
|-------------|-----------------|-----------------------------------------------------------------------|
| `id`        | string          | Note id — use for the deep link.                                      |
| `title`     | string          | First line of the note, markdown heading stripped.                    |
| `due_at`    | number \| null  | Epoch **milliseconds**, or null if no due date.                       |
| `subject`   | string \| null  | Category/label, or null.                                              |
| `due_label` | string          | Ready-to-show: `overdue`/`today`/`tomorrow`/`mon`…/`Jun 12`, `""` if no date. |
| `overdue`   | bool            | `true` if past due — use to color the row red.                        |

The list is **incomplete, non-archived tasks only**, sorted by due date ascending (no-due-date
tasks last), capped at **20**. The `due_label` / `overdue` fields exist specifically so KWGT
needs no date math — just display the strings.

---

## Step 1 — Fetch once into a Global

To avoid one network request per displayed field, fetch the whole response once and reuse it.

1. In the KWGT editor, open **Globals** and add a **Text** global named `tasks`.
2. Set its formula (tap the `fx` button) to the fetch:

   ```
   $wg("https://noteflow-api.jeppesen.cc/api/widget/tasks?token=YOUR_TOKEN&tzoffset=120", json)$
   ```

   This stores the raw JSON. Every field below then parses the **global** (no extra fetches):
   `wg(gv(tasks), json, .path)`.

> **Refresh:** Kustom caches network responses; the widget refreshes on its update interval. The
> practical floor on Android is ~30 minutes (KWGT's lowest network refresh / OS widget limits).
> Set it under the widget's global update settings. To force a refresh while editing, tap the
> on-screen refresh in the KWGT editor.

---

## Step 2 — Build the task list

KWGT has **no loops**, so you build a fixed number of rows and hide the empty ones.

1. Add a **Stack Group** (vertical) for the list.
2. Create **one row** as a sub-group: a **Text** item for the title, another for `due_label`,
   optionally one for `subject`.
3. **Duplicate the row** for as many tasks as you want to show (6–8 is typical). In each copy,
   change the array index `i` (`0`, `1`, `2`, …).

For row index `i`, set the text formulas:

| Element  | Formula                                            |
|----------|----------------------------------------------------|
| Title    | `$wg(gv(tasks), json, .tasks[i].title)$`           |
| Subject  | `$wg(gv(tasks), json, .tasks[i].subject)$`         |
| Due      | `$wg(gv(tasks), json, .tasks[i].due_label)$`       |

**Hide empty rows** — set the row group's **Visibility → Formula** to show only when a title
exists, e.g.:

```
$if(wg(gv(tasks), json, .tasks[i].title) = "", 0, 1)$
```

(`0` = hidden, `1` = visible.)

**Overdue styling** — on the Due text item, set its **Color → Formula** to red when overdue:

```
$if(wg(gv(tasks), json, .tasks[i].overdue) = "true", #FFE53935, #FF888888)$
```

---

## Step 3 — Tap a row to open the task

Select a row group → **Touch → Tap → Open Link**, set the URL to a formula so it deep-links the
specific task into the PWA:

```
https://notes.jeppesen.cc/#/task/$wg(gv(tasks), json, .tasks[i].id)$
```

Other useful PWA deep links (e.g. for a header button):

- New task: `https://notes.jeppesen.cc/#/new-task`
- All tasks: `https://notes.jeppesen.cc/#/tasks`

---

## KWGT vs. the bundled widget

| | KWGT | `noteflow-widget` (bundled) |
|---|---|---|
| Look & feel | Fully customizable | Fixed |
| Setup | Manual, per-row | Install + paste token |
| Cost | Needs KWGT Pro key | Free |
| Data source | `/api/widget/tasks` | `/api/widget/tasks` |
| Refresh | ~30 min min | ~30 min min |
| Deep links | `#/task/:id` etc. | `#/task/:id` etc. |
