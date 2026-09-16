# Kitchen

A recipe journal. Paste a recipe in and it works out the ingredients and steps.
Cook it, photograph it, say what you thought. Then it remembers: what you made,
when you made it, how it went, and what to do differently next time.

![The recipe list, a recipe, and the calendar of what got cooked](assets/screenshot.png)

**Live:** https://annika-thomas.github.io/recipes/

No accounts, no API keys, nothing to sign up for. Everything happens in the
browser and your recipes stay on your device.

---

## What it does

**Paste anything recipe-shaped.** A message from a friend, a block of text off a
website, a note to yourself. It reads the quantities, units, ingredients and
steps out of it and hands you a filled-in form. Headings like *Ingredients* and
*Method* help but aren't required — numbered steps and quantities at the start
of a line are enough to go on.

It's a parser, not a mind reader, so it opens the editor rather than saving
straight to the box, with what you pasted kept underneath in case it misread
something. Quantities and oven temperatures are the parts nobody proofreads and
the parts that ruin dinner.

**Or type it in.** Enter jumps to the next ingredient, so a family recipe takes
about a minute.

**Photos.** A picture of the dish on the recipe, and a picture on each time you
cooked it — so the calendar shows what it actually looked like that Tuesday,
not what it's supposed to look like.

**Cooking from it.** Scale a recipe up or down and every quantity follows,
rendered as fractions (`1½ cup`, not `1.5 cup`). Tick ingredients and steps off
as you go. Ingredients you already have get a green dot. **Cook mode** puts one
step on screen at big type, holds the screen awake, shows the ingredients for
*that* step, and swipes between them.

**The journal.** "We made this" logs the date, with a photo and a note. Ratings
are per person, so *she loved it, he didn't* survives. Notes are the things
worth remembering — *needed 10 more minutes*, *double the garlic*.

**The calendar.** A month grid of what got cooked when, a timeline under it, and
the totals: meals, how many in the last 30 days, what you make most.

**The kitchen.** A list of what's in the fridge, freezer, cupboard and spice
rack, plus staples you never want to tick off. Feed it that and *What can I
make?* ranks every recipe by how much of it you already have — the ones you can
make tonight at the top, the ones you're two things short of below with the two
things named, because that's a shopping list, not a failure.

---

## Using it

Open **https://annika-thomas.github.io/recipes/** on your phone, tap Share →
**Add to Home Screen**, and it behaves like an app: full screen, its own icon,
works with no signal.

It asks for your name once. There's no passcode, because nothing leaves your
device for anyone to get at.

### Sharing a recipe into it

Select the recipe text on a page, share it, and land in the paste box with it
already filled in. One Shortcut does that:

1. **Shortcuts** app → **+** → the **ⓘ** at the bottom → turn on **Show in Share
   Sheet**, and under *Share Sheet Types* leave only **Text** ticked.
2. Add the action **URL Encode**, with **Shortcut Input** as its input.
3. Add the action **Text** and set it to:
   ```
   https://annika-thomas.github.io/recipes/?text=
   ```
   then insert the **URL Encoded Text** variable from step 2 at the end.
4. Add **Open URLs**, taking the Text from step 3.
5. Name it **Save recipe**.

Now: select a recipe on any page → Share → **Save recipe**.

### Your recipes live on your device

In this browser's storage, with the photos in a separate store sized for them.
Nothing is uploaded and no account exists, which is why it needs no setup — and
why clearing this site's data would take the recipes with it.

**Settings → Download a backup** writes everything to one file. Worth doing
occasionally, and it's also how you get recipes onto another device:
**Open a backup** there merges rather than overwrites, so you can do it as often
as you like without making duplicates.

The one thing this shape can't do is keep two phones in step automatically.
That needs a server — see [Sharing between two phones](#sharing-between-two-phones).

---

## How the parsing works

Worth knowing, because it explains what it's good and bad at.

It reads the text for the things recipes always have. A line starting with a
quantity is an ingredient. A line starting with a number and a full stop, or
with a verb like *heat* or *stir*, is a step. Headings like **Ingredients** and
**Method** settle it outright; without them, it finds the point where short
quantity-ish lines stop and long instruction-ish ones begin, and cuts there.

It handles the ways people actually write amounts: `1 1/2`, `2½`, `¾`,
`2-3 cloves`, `2 to 3 tbsp`, `two onions`, `a pinch of`. Prep instructions after
a comma become notes rather than part of the ingredient, which is what lets
"3 cloves garlic, finely minced" match "garlic" in your cupboard.

**What it does well:** anything laid out as a list. Blog recipes, cookbook
formats, recipe cards, messages with one ingredient per line. It skips the
author's preamble and reads *Serves 4*, *Prep: 20 mins*, *Makes 12 cookies*.

**What it struggles with:** a paragraph of prose with no structure, and
ingredients run together on one line. It doesn't silently guess — a quantity
that wasn't in the text comes out blank, and if it couldn't find ingredients or
steps it says so at the top of the form.

---

## Sharing between two phones

The app also runs against a server, which is the only way two people see one
recipe box that stays in step. Same code, same recipes, same backup format —
the app works out at boot which it's talking to.

That needs a free [Cloudflare account](https://dash.cloudflare.com/sign-up) —
no card, no plan — and about ten minutes:

```bash
git clone -b claude/recipe-sharing-app-0snh6g \
  https://github.com/annika-thomas/recipes.git kitchen
cd kitchen
npm install
npx wrangler login
npm run deploy:setup
```

`deploy:setup` creates the database and photo bucket, writes the ids into the
config for you, asks for a passcode, deploys, and prints your URL. It skips
anything already done, so it's safe to re-run.

Then take a backup from the Pages version and open it on the new one. Nothing
you've typed in is lost.

There's no API key anywhere in this, on either version — the parser runs in
the browser in both.

---

## Running it on your laptop

```bash
npm install
npm run pages       # http://localhost:8099 — exactly what GitHub Pages serves
```

For the server version instead:

```bash
npm run setup       # asks for a passcode, makes a local database
npm run dev         # http://localhost:8787
```

- `npm test` runs the tests: the parser against a dozen real recipe formats,
  the device storage backend, and the ingredient matcher. Those are the parts
  that rot quietly — when they break you get a recipe with no steps rather than
  an error.
- `npm run db:reset:local` empties the local server database.

### Where the things you'll want to change live

| To change | Edit |
| --- | --- |
| Colours, spacing, the whole look | `public/css/app.css` — the `:root` block at the top is the palette, and the dark theme mirrors it |
| The categories | `CATEGORIES` in `public/js/util/recipe.js`, and the matching emoji in `public/js/ui/icons.js` |
| How pasted text is read | `public/js/util/parseRecipe.js` — units, step verbs and the scoring all live at the top |
| Which staples "add the usual" adds | `DEFAULT_STAPLES` in `public/js/util/recipe.js` |
| How recipes are sorted by default | `SORTS` and `sortRecipes` in `public/js/ui/library.js` |
| Storage locations (fridge, freezer…) | `LOCATIONS` in `public/js/util/recipe.js` |

If you rename a **category id** after saving recipes under it, those recipes
keep the old id and show as Mains. Renaming a `label` is always safe.

---

## How it's put together

```
public/                    the app: a static PWA, no build step
  config.js                which storage this copy uses; the Pages build pins it
  js/store.js              all app state, and the choice of backend
  js/backends/local.js     the whole box in localStorage — what Pages runs
  js/backends/photos.js    pictures, in IndexedDB, shrunk on the way in
  js/backends/server.js    the same surface over HTTP — what Cloudflare runs
  js/util/parseRecipe.js   pasted text -> a recipe
  js/util/recipe.js        what a recipe IS — imported by both halves
  js/util/match.js         ingredient matching — imported by both halves
  js/ui/                   one file per screen, unaware of which backend is live

worker/                    the optional server, for sharing between two phones
schema.sql                 its database
test/                      the parser, the device backend, the matcher
```

No framework, no build step. Wrangler bundles the Worker; the browser loads the
ES modules directly.
