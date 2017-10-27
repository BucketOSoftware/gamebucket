Gamebucket
==========

Gamebucket is an experimental data manipulation system/language/compiler for games. It is incomplete and definitely not ready for production use, but I'm sharing it in case you find it interesting. If you want to know the whole cautionary tale, read on!

Motivation
----------
Game programming presents different problems compared to other types of software. Performance requirements are tighter, and game entities interact in complicated and subtle ways. The usual advice is to use object oriented programming, making every entity a class and using inheritance to share common functionality. However, I found that once my game got complex enough to be interesting, most of my game logic needed to know about multiple different aspects of the game state and ended up in a fairly generic "god class". As a bonus, it turns out object oriented code [isn't friendly to CPU caches][Llopis], creating performance problems I couldn't fix.

An entity-component approach, as seen in the Unity game engine, moves code into components that can be attached to entities in different combinations to create different behaviors. This seems more elegant and more amenable to testing, since a component can have a single purpose and doesn't depend on code specific to the entity. Even in basic Unity documentation, though, this approach shows some limitations. Components often have to check for the presence of another component and read its data to make decisions; also, if your plumber entity has a Jumpable component and your turtle entity has a Stompable component, where do you put the code that decides what to do when the two collide? If you distribute your core game logic amongst a bunch of small classes, does that make it harder to get a clear picture of what's happening?

Object oriented programming has us combining data and code as a matter of principle, but [some well-argued backlash][Yegge] has had me questioning the benefits. While business software is generally OOP, it has been using no-encapsulation, no-inheritance relational databases to great success for years. And if you think of an entity-component system without the code, it looks a lot like a relational database schema, where each property is a column and each instance of the component is a row.

This project was an attempt to make relational database functionality work for real time applications like games, encouraging data oriented design.

Design
------

Gamebucket consists of two main parts: a data definition and query language (BQL?), and a compiler that turns that language into a JavaScript module (a "Bucket"). Each table becomes an internally-managed array of objects, with functions to modify and retrieve the contents row by row, and each named query (called a view) is a function that acts like an immutable table.

Because the structure of the data is defined at compile time, several benefits are possible (which is to say, not necessarily implemented):
 * Users can express their game logic as side-effect-free queries, stored in a single file or grouped into related chunks. The external game code can focus on imperative actions based on the results of the queries.
 * Although all the data is public, the use of declarative queries mean that the dependencies are visible. It would also be possible to support "private" queries or tables, which can be extended in the query files but not referenced in the external code.
 * Since all data manipulation goes through the generated code, query results can be cached and the caches can be invalidated automatically.
 * Garbage collection pauses can be reduced by preallocating and pooling rows, which is cumbersome to do by hand.
 * Static data such as lookup tables can be stored in CSV files, imported at compile time, and cross-referenced in queries

The parser was implemented with [Jison][Jison], which worked very well. I designed the query language to work more like a functional pipeline than the natural language approach of SQL. For the initial design, the only available column types were numbers, enumerations, and vectors, which seemed sufficient for most game logic. I implemented most of the language features test-first, which I would definitely recommend for this type of project.

### An Example
Here's an excerpt from a query file for a falling block puzzle game. We define a table to hold our falling 4-block piece by defining its shape, central position, and number of rotations (which we'll clamp between 0-3 in our application code):
```
type Shape: enum(L, J, O, I, Z, S, T)
table activeTetrad:
  pos Int[2],
  shape Shape,
  rotation Int
 ```

When we render a frame, we can get the location and color of the four blocks of our falling piece by joining to the `offsets` table, which has four rows for each combination of shape and rotation, and the `shapeColor` table, which maps between shapes and colors. The `project` statement adds the piece's central position and an offset, storing it in an output vector. 
```
view activeBlocks:
  from(activeTetrad AS at)
  join(offsets AS o)
  join(shapeColors AS sc)
  project(pos Int[2] ->{
    vec2.add(pos, at.pos, o.offset)
  } AS pos, sc.color)
```

When the active piece lands, we insert the contents of `activeBlocks` into `landedBlocks`, since we only care about them individually now, and clear the row from `activeBlocks` before we add another.
```
table landedBlocks:
  pos Int[2],
  color Color
 ```

The game is over when there's no room for a new piece. To detect this, we join `activeBlocks` and `landedBlocks` on the `pos` column, so that we get an output row for each combination of `activeBlocks` and `landedBlocks` that have the same `pos`. We don't actually care about the contents of those rows, so we use the grouping function any() to output true as long as the query returns at least one row.
```
view overlap:
  from(activeBlocks)
  join(landedBlocks ON pos)
  any()
 ```

Problems
--------

As I started building out a few simple games along with the compiler, I began to run into some stumbling blocks:

**Reference semantics in JS:** Restricting access to the Bucket's internal data is important for things like indexes and cache invalidation. This was easy enough with simple values, but since objects in JavaScript are always passed by reference, I couldn't find a good way to pass them to the user without creating temporary copies.

**Slow left joins:** Initially I hoped that compiling each query into a single-purpose retrieval function would be faster than evaluating the query at runtime. But when I implemented left joins (important for situations where one entity may or may not refer to another) I found that the resulting functions would be disproportionately slow in Chrome's CPU profiler. Left joining to `n` tables creates a function a cyclomatic complexity of `2^n`, so the slowness might be attributable to [branch misprediction][BranMis].

**Is this approach the best way to build out game logic?** One of the reasons I started this project is that it seemed like a good way to build a game by expressing the game rules and [building imperative code around them][Bernhardt]. I did a quick bake-off, implementing a Tetris-like game in Gamebucket and with C-style imperative code and found that the Gamebucket version was much clearer and just as efficient. Nice!

The problem is, Tetris is very elegant and, most importantly, already designed. When I started applying the concept to new game ideas, I found that I ended up with layers of intricately-planned queries that had to be regularly reworked whenever I wanted to tweak a minor aspect of the game. That effort may be worth it for a finished, guaranteed-fun game design, but creating one of those requires a lot of iteration.

Why do business applications seem to use relational databases more successfully, even while prototyping? I think it's because there's less pressure to express everything as a query: an established app rewrite logic as a complex SQL query if it's more efficient, but there's always the option of pulling data into your language of choice and manipulating it there. Since Gamebucket was intended to obviate the need for that kind of boilerplate, it's probably not the right solution.

Conclusion
----------
I may eventually decide to tackle the above issues, but it looks like that may take more effort than the finished product would save. Besides, [data oriented design][Llopis] doesn't need to be all-or-nothing; no matter what tools you're using, you can benefit from focusing on the most basic set of data your app needs, which data can be re-derived on demand, and which state manipulations make sense. If you find you have a similarly sweeping vision, I would recommend attempting a simpler implementation in the context of a larger project and spinning it off if it works out. Good luck!

Further Reading
---------------

**[Out of the Tar Pit][Mosely & Marks]** discusses the ways in which state complicates software, and offers an alternate approach.

**[LINQ](https://msdn.microsoft.com/en-us/library/bb308959.aspx)** is a Microsoft invention that similarly uses a SQL-like interface to query different types of data.

**[SQLite's VDBE tutorial](https://sqlite.org/vdbe.html)** is outdated but a good explanation of how that database turns queries into imperative instructions.

[Llopis]: http://gamesfromwithin.com/data-oriented-design
[Yegge]: https://steve-yegge.blogspot.com/2006/03/execution-in-kingdom-of-nouns.html
[Jison]: https://github.com/zaach/jison
[BranMis]: https://en.wikipedia.org/wiki/Branch_misprediction
[Bernhardt]: https://www.destroyallsoftware.com/talks/boundaries
[Mosely & Marks]: https://github.com/papers-we-love/papers-we-love/blob/master/design/out-of-the-tar-pit.pdf
