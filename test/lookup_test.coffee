{ compile, sortNumbers, setTestName } = require './helper'
beforeEach setTestName
afterEach td.reset
bucket = null

describe "lookup table", ->
  it "gets data from a CSV", ->
    code = '''
      type Letter: enum(A, B, C)
      table alphanum:
        al Letter,
        num Number
        * source("letter.csv")
    '''
    bucket = compile code,
      fileContents: -> '''
        al,num
        A,1
        B,2
        C,3
      '''

    callback = td.function()
    bucket.alphanum.forEach(callback)

    expect(callback).to.have.been.calledWith('B', 2)
    expect(callback).to.have.been.calledWith('A', 1)
    expect(callback).to.have.been.calledWith('C', 3)
