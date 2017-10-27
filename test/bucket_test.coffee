{ compile, sortNumbers, setTestName } = require './helper'
{ CompilerError } = require '../src/compiler'
beforeEach setTestName
afterEach td.reset
bucket = null

describe 'the bucket manifest', ->
  it "errors on duplicate definitions", ->
    code =  '''
            table dupe: a int
            table dupe: b int, c int
            '''
    expect(-> compile(code)).to.throw(CompilerError)

  it "imports CommonJS modules", ->
    code = '''
      import "multiply" as mul
      table t: n Number
      view v: from(t) project({ mul(n, 10) })
    '''

    bucket = compile code,
      modules:
        multiply: (a,b) -> a * b

    bucket.t.insert(n) for n in [1..3]
    callback = td.function()
    bucket.v(callback)

    expect(callback).to.have.been.calledWith(n) for n in [10, 20, 30]

  it "can have private views", ->
    bucket = compile '''
      table t: n Number
      private view v: from(t) project({ n * 2 })
    '''

    expect(bucket.t).to.be.an 'object'
    expect(bucket.v).to.be.undefined

  it.skip "includes user JavaScript", ->
    bucket = compile '''
      vecLen: {
        function(vec) {
            var x = vec[0], y = vec[1];
            return Math.sqrt(x*x + y*y);
        }
      }

      table vectors:
        v Float32[2]

      view withLengths:
        from(vectors)
        project(v, { vecLen(v) })
    '''
    bucket.vectors.insert(1, 0)
    bucket.vectors.insert(0, 2)
    bucket.vectors.insert(4, 3)

    callback = td.function()
    bucket.withLengths(callback)

    expect(callback).to.have.been.calledWith(Float32Array.from([1,0]), 1)
    expect(callback).to.have.been.calledWith(Float32Array.from([0,2]), 2)
    expect(callback).to.have.been.calledWith(Float32Array.from([4,3]), 3)
