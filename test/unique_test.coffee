{ compile, sortNumbers, setTestName } = require './helper'
{ CompilerError } = require '../src/compiler'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "uniqueness constraint", ->
  beforeEach ->
    bucket = compile '''
      table single:
        n Int,
        o Int
        * unique(n)

      table double:
        x Int, y Int
        * unique(x, y)

      table vector:
        v Int[2]
        * unique(v)
    '''

  describe 'on a single column', ->
    it "errors on inserting a row with a duplicate column", ->
      bucket.single.insert 9, 7
      expect(-> bucket.single.insert 9, 7).to.throw(/duplicate/i)

    it "errors on updating a row with a duplicate column", ->
      bucket.single.insert 9, 7
      bucket.single.insert 8, 7

      expect(->
        bucket.single.updateAll (row) ->
          row.n = 9
          row.save()
      ).to.throw(/duplicate/i)


    it "does not error on removing and inserting values with the same key", ->
      bucket.single.insert 9, 7
      bucket.single.destroyWhere -> true
      
      expect(-> bucket.single.insert 9, 7).not.to.throw()


  describe 'on two columns', ->
    it.skip "errors on inserting a row with a duplicate column", ->
      bucket.double.insert 9, 7
      expect(-> bucket.double.insert 8, 7).not.to.throw
      expect(-> bucket.double.insert 9, 7).to.throw(/duplicate/)

  describe 'on a vector column', ->
    it.skip "errors on inserting a row with a duplicate column", ->
      bucket.vector.insert 9, 7
      expect(-> bucket.vector.insert 8, 7).not.to.throw
      expect(-> bucket.vector.insert 9, 7).to.throw(/duplicate/)
