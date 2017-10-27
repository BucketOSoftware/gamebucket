{ compile, sortNumbers, setTestName } = require './helper'
{ CompilerError } = require '../src/compiler'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "view", -> # AKA derived relations

  describe "where()", ->
    beforeEach ->
      bucket = compile '''
        table simple: a Int

        view largeNumbers:
          from(simple)
          where({ a > 100 })

        view notZero:
          from(simple)
          where({ a })
      '''

    it "only returns rows that pass its filters", ->
      [5, 10, 15, 100, 200, 300].forEach (n) ->
        bucket.simple.insert n

      result = []
      bucket.largeNumbers((n) -> result.push(n))
      expect(result.sort(sortNumbers)).to.deep.equal([200, 300]);

    it.skip "returns the number of rows that match its filters", ->
      [5, 10, 15, 100, 200, 300].forEach (n) ->
        bucket.simple.insert n

      expect(bucket.simple.count()).to.equal(6)
      expect(bucket.largeNumbers.count()).to.equal(2)

    # not a great place for bug tests, is it?
    it "catches a bug on an expression that is just a column name", ->
      bucket.simple.insert n for n in [0, 0, 1]

      callback = td.function()
      bucket.notZero(callback)

      expect(callback).to.have.been.calledWith 1
      expect(callback).not.to.have.been.calledWith 0

  describe "product()", ->
    it "returns every permutation of the rows in both tables", ->
      bucket = compile '''
        table ones: a Int
        table tens: b Int
        view both:
          from(tens)
          product(ones)
      '''

      [0, 5].forEach (n) -> bucket.ones.insert n
      [10, 20, 30].forEach (n) -> bucket.tens.insert n

      result = []
      bucket.both (b, a) -> result.push(b - a)  # minus because it's not
                                                # commutative; order matters
      expect(result.sort(sortNumbers)).to.deep.equal [ 5, 10, 15, 20, 25, 30 ]

  describe "from() and product()", ->
    it "can alias the table for subsequent commands", ->
      bucket = compile '''
        table simple: a Int
        view renamed:
          from(simple AS sim)
          product(simple AS sim2)
          project({ sim.a * 2 }, sim2.a)
      '''
      bucket.simple.insert(n) for n in [1..2]
      callback = td.function()
      bucket.renamed(callback)

      expected = [ [2, 1], [2, 2], [4, 1], [4, 2] ]
      expect(callback).to.have.been.calledWith(x,y) for [x, y] in expected

  describe "project()", ->
    it "selects columns from the input relation", ->
      bucket = compile '''
        table triple: a Int, b Int, c Int
        view onlyB: from(triple) project(b)
      '''
      bucket.triple.insert(1, 10, 100)
      bucket.triple.insert(2, 20, 200)

      callback = td.function()
      bucket.onlyB(callback)

      # order is undefined      
      expect(callback).to.have.been.calledWith(10)
      expect(callback).to.have.been.calledWith(20)

    it "can rename columns", ->
      bucket = compile '''
        table triple: a Int, b Int, c Int
        view confusing: from(triple) project(a as b, b as c)
        view realB: from(confusing) project(c)
      '''
      bucket.triple.insert(1, 10, 100)
      bucket.triple.insert(2, 20, 200)

      callback = td.function()
      bucket.realB(callback)

      expect(callback).to.have.been.calledWith(10)
      expect(callback).to.have.been.calledWith(20)

    it "disambiguates columns by specifying table names", ->
      bucket = compile '''
        table one: column Int
        table two: column Int
        view both: from(one) product(two) project(two.column, one.column)
      '''

      bucket.one.insert(20)
      bucket.two.insert(40)
      callback = td.function()
      bucket.both(callback)

      expect(callback).to.have.been.calledWith(40, 20)

    it "derives new columns from existing ones", ->
      bucket = compile '''
        table numbers: number Int
        view squares: from(numbers) project(number, { number * number })
      '''
      [1, 2, 3].forEach (n) -> bucket.numbers.insert(n)
      callback = td.function()
      bucket.squares(callback)

      expect(callback).to.have.been.calledWith(1, 1)
      expect(callback).to.have.been.calledWith(2, 2*2)
      expect(callback).to.have.been.calledWith(3, 3*3)

    it "works with derived columns", ->
      bucket = compile '''
        table numbers: number Int
        view squares: from(numbers) project(number, { number * number } AS squared)
        view squaresOnly: from(squares) project(squared, squares.squared)
      '''

      bucket.numbers.insert n for n in [1, 2, 3]
      callback = td.function()
      bucket.squaresOnly(callback)

      expect(callback).to.have.been.calledWith(1, 1)
      expect(callback).to.have.been.calledWith(2*2, 2*2)
      expect(callback).to.have.been.calledWith(3*3, 3*3)

    it "catches mutually-derived columns", ->
      code = '''
        table numbers: number Int
        view larger:
          from(numbers)
          project({ what * 2 } AS nope, { nope * 3 } AS what)
      '''
      # TODO: catch without having to hit the stack limit
      # expect(-> compile code).not.to.throw(Error) #CompilerError
      expect(-> compile code).not.to.throw(RangeError)  # infinite recursion

    it "takes multiple table arguments", ->
      bucket = compile '''
        table one: n Int
        table two: n Int
        table three: n Int
        view all: from(two) product(one, three)
      '''

      bucket.one.insert 1
      bucket.two.insert 2
      bucket.three.insert 3

      callback = td.function()
      bucket.all(callback)

      expect(callback).to.have.been.calledWith(2, 1, 3)

    it "uses * to mean all columns", ->
      bucket = compile '''
        table t: n Number
        view three: from(t) project(n, { n * 10 }, { n * 100 })
        view four: from(three) project(*, { n * 1000 })
      '''

      bucket.t.insert(2)

      callback = td.function()
      bucket.four(callback)

      expect(callback).to.have.been.calledWith(2, 20, 200, 2000)

    it "can select all columns from one relation using *", ->
      bucket = compile '''
        table a: u Number, v Number
        table b: x Number, y Number
        view c: from(a) product(b) project(a.*)
      '''

      bucket.a.insert(1, 2)
      bucket.b.insert(3, 4)

      callback = td.function()
      bucket.c(callback)

      expect(callback).to.have.been.calledWith(1, 2)

  describe "join()", ->
    it "performs a natural join on common columns", ->
      bucket = compile '''
        type Lett: enum(A, B, C)
        table left: l Lett, n Int, x Number
        table right: l Lett, n Int, y Number
        view both:
          from (left)
          join (right AS rt)
          project(l, x, rt.y)
      '''

      bucket.left.insert('A', 1, 100)
      bucket.right.insert('A', 1, 150)
      bucket.left.insert('B', 2, 200)
      bucket.right.insert('B', 2, 250)
      bucket.left.insert('C', 3, 300)
      bucket.right.insert('C', 4, 350)

      callback = td.function()
      bucket.both(callback)

      expect(callback).not.to.have.been.calledWith 'C',
        td.matchers.anything(),
        td.matchers.anything()
      expect(callback).to.have.been.calledWith(l, x, y) \
        for [l, x, y] in [['A', 100, 150],
                          ['B', 200, 250]]

    it "joins to another view", ->
      bucket = compile '''
        table a: n Int
        view evens: from(a) where({ !(n % 2) })
        view odds: from(a) where({ n % 2 }) project(n, n AS same)
        view twiceIfOdd: from(a) join(odds)
      '''
      bucket.a.insert n for n in [1..4]

      callback = td.function()
      bucket.twiceIfOdd(callback)

      expect(callback).to.have.been.calledWith(1, 1)
      expect(callback).to.have.been.calledWith(3, 3)

    it "can join on a column projected in the same view", ->
      bucket = compile '''
        table t: n Int
        table q: j Int
        view renamed: from(t) project(n AS sq)
        view selfsquare:
          from(q)
          project({ Math.pow(j, 2) } AS sq)
          join(renamed)
      '''
      bucket.t.insert n for n in [1..10]
      bucket.q.insert n for n in [1..100]

      callback = td.function()
      bucket.selfsquare(callback)

      expect(callback).to.have.been.calledWith(n) for n in [1, 4, 9]

  describe "leftJoin()", ->
    beforeEach ->
      bucket = compile '''
        table a: id Int, alice Int
        table b: id Int, bob Int
        table c: id Int, carol Int
        view lj: from(a) leftJoin(b)
        view l2j: from(a) leftJoin(b) leftJoin(c) project(id, bob, carol)
      '''

    it "returns rows that don't match on a natural inner join", ->
      bucket.a.insert(1, 100)
      bucket.a.insert(2, 200)
      bucket.a.insert(3, 300)

      bucket.b.insert(1, 101)
      bucket.b.insert(2, 201)

      callback = td.function()
      bucket.lj(callback)

      expect(callback).to.have.been.calledWith(1, 100, 101)
      expect(callback).to.have.been.calledWith(2, 200, 201)
      expect(callback).to.have.been.calledWith(3, 300, null)

    it "works consecutively", ->
      bucket.a.insert(1, 100)
      bucket.a.insert(2, 200)
      bucket.a.insert(3, 300)

      bucket.b.insert(2, 201)
      bucket.c.insert(3, 301)

      callback = td.function()
      bucket.l2j(callback)

      expect(callback).to.have.been.calledWith(1, null, null)
      expect(callback).to.have.been.calledWith(2,  201, null)
      expect(callback).to.have.been.calledWith(3, null,  301)

  describe "any()", ->
    it "returns true if the view has any rows", ->
      bucket = compile '''
        table numbers: n Int
        view evens:
          from (numbers) where({ n % 2 === 0 }) any()
      '''

      bucket.numbers.insert x for x in [1, 3, 5, 7, 9]
      expect(bucket.evens()).to.equal false
      bucket.numbers.insert x for x in [2, 4]
      expect(bucket.evens()).to.equal true

  describe "variable dereferencing", ->
    it "errors on ambiguous references", ->
      code = '''
        table left: a Int, b Int
        table right: a Int
        view ambig: from(left) product(right) where({ b > a })
      '''
      expect(-> compile code).to.throw() #CompilerError

    it "errors on nonexistent references", ->
      code = '''
        table t: col Int
        view missing: from(t) where({ col > noColumnHere })
      '''
      # TODO: figure out a good way to throw compiler errors
      expect(-> compile code).to.throw() #(CompilerError)

    it "can access the JavaScript environment", ->
      bucket = compile '''
        table numbers: number Int
        view squares: from(numbers) project({ Math.pow(number, number) })
      '''
      [1, 2, 3].forEach (n) -> bucket.numbers.insert(n)
      callback = td.function()
      bucket.squares(callback)

      expect(callback).to.have.been.calledWith(1)
      expect(callback).to.have.been.calledWith(4)
      expect(callback).to.have.been.calledWith(27)

    it "recognizes view aliases", ->
      bucket = compile '''
        table a: number Int
        table b: number Int
        view isDouble:
          from(a) product(b)
          where({ a.number * 2 === b.number })
        view square:
          from(isDouble AS double)
          project({ Math.pow(double.number, 2) })
      '''

      bucket.a.insert n for n in [1,2,3,4]
      bucket.b.insert n for n in [4,5,6]

      callback = td.function()
      bucket.square(callback)

      expect(callback).to.have.been.calledWith(n) for n in [4**2, 6**2]

  describe "as intermediate data source", ->
    beforeEach ->
      bucket = compile '''
        table nums: a Int
        view evens:
          from(nums)
          where({ a % 2 === 0 })

        view expanded: from(nums) product(evens)
        view expandedReverse: from(evens) product(nums)
      '''
      bucket.nums.insert n for n in [1..4]

    it "works in product()", ->
      callback = td.function()
      bucket.expanded(callback)

      expected = [
        [1, 2], [2, 2], [3, 2], [4, 2],
        [1, 4], [2, 4], [3, 4], [4, 4]
      ]
      
      expect(callback).to.have.been.calledWith(x,y) for [x, y] in expected

    it "works in from()", ->
      callback = td.function()
      bucket.expandedReverse(callback)

      expected = [
        [2, 1], [2, 2], [2, 3], [2, 4],
        [4, 1], [4, 2], [4, 3], [4, 4]
      ]
      
      expect(callback).to.have.been.calledWith(x,y) for [x, y] in expected

  it "invokes the second callback if there are no rows", ->
    bucket = compile '''
      table t: num Int
      view evens: from(t) where({ num % 2 === 0 })
    '''
    bucket.t.insert(1)

    callback = td.function('row')
    noRows = td.function('no rows')
    bucket.evens(callback, noRows)
    
    expect(callback).not.to.have.been.called
    expect(noRows).to.have.been.called

  it "errors on views that reference each other", ->
    code = '''
      view one: from(two) project({x * 2} AS a)
      view two: from(one) project({a * 2} AS b)
    '''
    # TODO: catch without just overflowing the stack
    # expect(-> compile code).not.to.throw(Error) #CompilerError
    expect(-> compile code).to.throw(RangeError)  # infinite recursion
