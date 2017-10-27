{ compile, sortNumbers, setTestName } = require './helper'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "vector column", ->
  beforeEach ->
    bucket = compile '''
      table entities:
        hp Int,
        pos Float32[2],
        dest Float32[2],
        age Int

      view ages:
        from(entities) project(age, pos)
    '''

  it 'inserts as a series of arguments', ->
                        #  hp   pos   dest   age
    bucket.entities.insert(20,  0,0,  0,10,  20)
    bucket.entities.insert(12,  0,5,  0,1,   35)

    callback = td.function()
    bucket.ages(callback)

    expect(callback).to.have.been.calledWith(20, Float32Array.from([0,0]))
    expect(callback).to.have.been.calledWith(35, Float32Array.from([0,5]))

  it 'can be updated as an array', ->
    hndl = bucket.entities.insert(20,  5,0,  0,10,  20)
    row = bucket.entities.update(hndl)
    row.pos[0] = (row.pos[0] + row.dest[0]) / 2
    row.pos[1] = (row.pos[1] + row.dest[1]) / 2

    callback = td.function()
    bucket.entities.forEach(callback)
    expect(callback).to.have.been.calledWith 20,
      Float32Array.from([5/2, 5]),
      Float32Array.from([0, 10]),
      20

  it.skip 'errors when reassigning a column', ->
    # TODO: requires proxy object
    hndl = bucket.entities.insert(20,  5,0,  0,10,  20)
    row = bucket.entities.update(hndl)
    expect(-> row.pos = [5/2, 5]).to.throw()

describe "derived vector column", ->
  beforeEach ->
    bucket = compile '''
      import "vcopy" as vcopy

      table twoCols:
        x Int, y Int

      view vectors:
        from(twoCols)
        project(v Float32[2] -> {
          vcopy(v, x, y)
        } AS v)

      table realVectors:
        v Float32[2]

      view matching:
        from(vectors)
        join(realVectors)
        any()
    ''', modules: vcopy: (v, x, y) -> v[0] = x; v[1] = y; v

  it "receives a prepopulated vector", ->
    bucket.twoCols.insert(97, 24)

    callback = td.function()
    bucket.vectors(callback)

    expect(callback).to.have.been.calledWith(Float32Array.from([97, 24]))

  it "works as a join column", ->
    bucket.twoCols.insert(97, 24)
    expect(bucket.matching()).to.equal(false)
    bucket.realVectors.insert(97, 24)
    expect(bucket.matching()).to.equal(true)
