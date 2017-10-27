{ compile, setTestName } = require './helper'
beforeEach setTestName
afterEach td.reset
bucket = null

# Might be misnamed, since they can be vectors
describe "scalar variable", ->
  beforeEach ->
    bucket = compile '''
      var z: Int = 97
      // var size: Int[2]
      //var width, height: Int = 2, 3

      table nums: a Int, b Int
      
      view numsAndZ: from(nums) product(z)
      view numsAndZAlt: from(nums) project(a, b, z)
      view zShadowed: from(nums) project(a AS z) project(z)
    '''

  it 'takes an initial value', ->
    expect(bucket.z).to.equal 97

  it 'errors when assigning a value of the wrong type', ->
    expect(-> bucket.z = { b: 'q'}).to.throw()

  it 'can be pulled into a query with product()', ->
    bucket.nums.insert 1, 2
    bucket.nums.insert 3, 4
    bucket.z = 5

    callback = td.function()
    bucket.numsAndZ(callback)

    expect(callback).to.have.been.calledWith(1, 2, 5)
    expect(callback).to.have.been.calledWith(3, 4, 5)

  it 'can be referenced in a query always', ->
    bucket.nums.insert 1, 2
    bucket.nums.insert 3, 4
    bucket.z = 6

    callback = td.function()
    bucket.numsAndZAlt(callback)

    expect(callback).to.have.been.calledWith(1, 2, 6)
    expect(callback).to.have.been.calledWith(3, 4, 6)

  it 'is shadowed by query scope', ->
    bucket.nums.insert 1, 2
    bucket.nums.insert 3, 4
    bucket.z = 7

    callback = td.function()
    bucket.zShadowed(callback)

    expect(callback).to.have.been.calledWith 1
    expect(callback).to.have.been.calledWith 3

  # TODO: would this actually work?
  it 'can be a vector'

describe "immutable scalar", ->
  beforeEach ->
    bucket = compile '''
      const y: Int = 97
    '''

  it 'cannot be modified', ->
    expect(bucket.y).to.equal 97

    # Why does this not work  
    # expect(-> bucket.y = 20).to.throw(Error)
    expect(-> bucket.y = 20).to.throw(/constant/)
