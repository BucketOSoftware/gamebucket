{ compile, sortNumbers, setTestName } = require './helper'
{ CompilerError } = require '../src/compiler'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "command", ->
  it "is not allowed in a view"

  it "modifies data through a view", ->
    bucket = compile '''
      table t: n Number

      view large:
        from(t)
        where({ n > 100 })
        project(n, { n * 10 })

      command halveEvens:
        from (large)
        where ({ n % 2 === 0 })
        set (n, { n / 2 })
    '''

    init = [1, 2, 3, 250, 251]
    bucket.t.insert n for n in init

    first = td.function()
    bucket.t.forEach(first)
    expect(first).to.have.been.calledWith(n) for n in init

    bucket.halveEvens()

    second = td.function()
    bucket.t.forEach(second)
    expect(second).to.have.been.calledWith(n) for n in [1, 2, 3, 125, 251]

  describe "destroy", ->
    it "deletes source rows that end up in a view", ->
      bucket = compile '''
        table t: n Number
        view large:
          from(t)
          where({ n > 100 })
          project(n, { n * 10 })

        command deleteLargeEvens:
          from (large)
          where ({ n % 2 === 0 })
          destroy (t)
      '''

      init    = [1, 2, 3, 250, 999, 3000]
      deleted = (n for n in init when n % 2 == 0 and n > 100)
      kept    = (n for n in init when n % 2 != 0 or n <= 100)

      bucket.t.insert n for n in init
      expect(bucket.t.count()).to.equal init.length

      bucket.deleteLargeEvens()

      callback = td.function()
      bucket.t.forEach(callback)
      expect(callback).to.have.been.calledWith(n) for n in kept
      expect(callback).not.to.have.been.calledWith(n) for n in deleted

    it "requires a table name as an argument", ->
      expect(-> compile '''
        table t: n Number
        command clearT: from(t) destroy()
      ''').to.throw(CompilerError)