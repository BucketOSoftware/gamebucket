{ compile, sortNumbers, setTestName } = require './helper'
# { CompilerError } = require '../src/compiler'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "table", -> # AKA essential state
  beforeEach ->
    bucket = compile 'table simple: a Int, b Int'

  describe "#count", ->
    it "returns the number of rows in a table", ->
      expect(bucket.simple.count()).to.equal(0)
      bucket.simple.insert(5, 7)
      expect(bucket.simple.count()).to.equal(1)

  describe "#forEach", ->
    it "invokes a callback once for each row", ->
      bucket.simple.insert(5, 7)
      bucket.simple.insert(9, 2)

      callback = td.function()
      bucket.simple.forEach(callback)

      # order is undefined      
      expect(callback).to.have.been.calledWith(9, 2)
      expect(callback).to.have.been.calledWith(5, 7)

  describe "#update", ->
    it "takes a row handle and returns a proxy object", ->
      bucket.simple.insert(1, 10)
      hndl = bucket.simple.insert(2, 20)
      bucket.simple.insert(3, 30)

      row = bucket.simple.update(hndl)
      row.b = 97

      callback = td.function()
      bucket.simple.forEach(callback)

      expect(callback).to.have.been.calledWith(1, 10)
      expect(callback).to.have.been.calledWith(2, 97)
      expect(callback).to.have.been.calledWith(3, 30)

    describe "proxy object", ->
      it "errors on trying to update a deleted row"

  describe "#destroy", ->
    it "removes a row from the table", ->
      bucket.simple.insert(1, 10)
      hndl = bucket.simple.insert(2, 20)
      bucket.simple.insert(3, 30)

      bucket.simple.destroy(hndl)

      callback = td.function()
      bucket.simple.forEach(callback)

      expect(callback).not.to.have.been.calledWith(2, 20)

  describe "#destroyWhere", ->
    it "removes rows where the callback returns true", ->
      bucket.simple.insert i, i+1 for i in [1..10]

      expect(bucket.simple.count()).to.equal 10

      bucket.simple.destroyWhere (a) -> a % 2 is 0
      expect(bucket.simple.count()).to.equal 5

      bucket.simple.destroyWhere -> true
      expect(bucket.simple.count()).to.equal 0
