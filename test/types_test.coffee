{ compile, setTestName } = require './helper'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "type checking", ->


  describe 'integer column', ->
    beforeEach ->
      bucket = compile 'table t: int Int'

    it 'errors when inserting decimals', ->
      expect(-> bucket.t.insert(5.5)).to.throw()

    it 'errors when inserting nulls', ->
      expect(-> bucket.t.insert(null)).to.throw()
      expect(-> bucket.t.insert(undefined)).to.throw()

    it 'errors when inserting other stuff', ->
      expect(->
        bucket.t.insert (-> 5)
        bucket.t.insert "hello"
        bucket.t.insert [1,2,3]

      ).to.throw()

  describe 'number column', ->
    beforeEach ->
      bucket = compile 'table t: num Number'

    it 'accepts integers and floats', ->
      expect(->
        bucket.t.insert 2.5
        bucket.t.insert 2
      ).not.to.throw()

    it 'errors when inserting nulls', ->
      expect(-> bucket.t.insert(null)).to.throw()
      expect(-> bucket.t.insert(undefined)).to.throw()

    it 'errors when inserting other stuff', ->
      expect(->
        bucket.t.insert (-> 5.5)
        bucket.t.insert "hello", 5.5
        bucket.t.insert [1, 2, 3]
        bucket.t.insert {a: 5.5}
      ).to.throw()

  describe 'enum columns', ->
    beforeEach ->
      bucket = compile '''
        type Color: enum(Red, Blue, Green)
        table t: c Color
      '''

    it 'accepts valid enum values', ->
      ['Red', 'Green', 'Green', 'Red', 'Blue'].forEach (c) ->
        bucket.t.insert 'Red'

    it "does not accept values that aren't part of the enum", ->
      expect(-> bucket.t.insert 'Yellow').to.throw()

    it 'exposes its legal values at runtime', ->
      expect(bucket.Color).to.include(color) for color in ['Red', 'Blue', 'Green']
