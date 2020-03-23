const FileSaver = require('file-saver')

const templates = require('./templates')
const elements = require('./elements')

const fetch = window['fetch']
const Blob = window['Blob']

// const Worker = window['Worker']

// Deep clone a simple object
function clone (obj) {
  return JSON.parse(JSON.stringify(obj))
}

// Create a dom element from string
// https://stackoverflow.com/questions/494143/creating-a-new-dom-element-from-an-html-string-using-built-in-dom-methods-or-pro/35385518#35385518
function htmlToElement (html) {
  let template = document.createElement('template')
  html = html.trim()
  template.innerHTML = html
  return template.content.firstChild
}

class Port {
  constructor (params) {
    console.log('[Port] Initializing Port with params: ', params)
    this.params = params

    // Get schema then initialize a model
    if (params.schema) {
      if (typeof params.schema === 'object') {
        console.log('[Port] Received schema as object: ', params.schema)
        this.init(params.schema)
      } else if (typeof params.schema === 'string') {
        console.log('[Port] Received schema as string: ', params.schema)
        this.schemaUrl = params.schema.indexOf('json') ? params.schema : params.schema + '.json'
        fetch(this.schemaUrl)
          .then(res => res.json())
          .then(res => {
            console.log('[Port] Loaded schema:', res)
            this.init(res)
          })
          .catch((err) => {
            console.log(err)
          })
      }
    }
  }

  // Initialize model from schema
  init (schema) {
    console.log('[Port] Initializing schema')

    // Convert JS code to string
    if (schema.model.code && (typeof schema.model.code !== 'string')) {
      console.log('[Port] Convert code in schema to string')
      schema.model.code = schema.model.code.toString()
    }

    // Check for worker flag
    if (typeof schema.model.worker === 'undefined') {
      schema.model.worker = true
    }

    this.schema = clone(schema)

    if (this.params.portContainer) {
      console.log('[Port] Init port element')
      // Get layout name
      const layout = (this.schema.design && this.schema.design.layout) ? this.schema.design.layout : 'blocks'
      const portElement = htmlToElement(templates[layout])
      this.params.portContainer.appendChild(portElement)
      // Get input, output and model containers
      this.inputsContainer = portElement.querySelector('#inputs')
      this.outputsContainer = portElement.querySelector('#outputs')
      this.modelContainer = portElement.querySelector('#model')
      // Make run button active
      if (!this.schema.model.autorun) {
        let runButton = portElement.querySelector('#run')
        runButton.style.display = 'inline-block'
        runButton.onclick = () => {
          this.run()
        }
      }
    } else {
      this.inputsContainer = this.params.inputsContainer
      this.outputsContainer = this.params.outputsContainer
      this.modelContainer = this.params.modelContainer
    }

    console.log('[Port] Init inputs, outputs and model description')

    // Update model URL if needed
    if (this.schema.model.url && !this.schema.model.url.includes('/') && this.schemaUrl && this.schemaUrl.includes('/')) {
      let oldModelUrl = this.schema.model.url
      console.log(this.schemaUrl)
      this.schema.model.url = window.location.protocol + '//' + window.location.host + this.schemaUrl.split('/').slice(0, -1).join('/') + '/' + oldModelUrl
      console.log('[Port] Changed the old model URL to absolute one:', oldModelUrl, this.schema.model.url)
    }

    // Iniitialize model description
    if (this.modelContainer && this.schema.model) {
      if (this.schema.model.title) {
        let h = document.createElement('h4')
        h.className = 'port-title'
        h.innerText = this.schema.model.title
        this.modelContainer.appendChild(h)
      }
      if (this.schema.model.description) {
        let desc = document.createElement('p')
        desc.className = 'model-info'
        desc.innerText = this.schema.model.description + ' '
        let a = document.createElement('a')
        a.innerText = '→'
        a.href = this.schema.model.url
        desc.appendChild(a)
        this.modelContainer.appendChild(desc)
      }
    }

    // Initialize inputs
    this.schema.inputs.forEach((input, i) => {
      console.log(input)
      let element
      switch (input.type) {
        case 'int':
        case 'float':
        case 'string':
          element = new elements.InputElement(input)
          break
        case 'checkbox':
          element = new elements.CheckboxElement(input)
          break
        case 'range':
          element = new elements.RangeElement(input)
          window['M'].Range.init(element.inputElement)
          break
        case 'text':
          element = new elements.TextareaElement(input)
          break
        case 'select':
        case 'categorical':
          element = new elements.SelectElement(input)
          break
        case 'file':
          element = new elements.FileElement(input)
          break
        case 'image':
          element = new elements.ImageElement(input)
          break
      }

      // Add onchange listener to original input element if model has autorun flag
      if (this.schema.model.autorun || input.reactive) {
        if (input.type === 'file') {
          element.cb = this
        } else {
          element.inputElement.onchange = () => {
            console.log('[Input] Change event')
            this.run()
          }
        }
      }

      // Add element to input object
      input.element = element
      this.inputsContainer.appendChild(element.element)
    })

    // Init Material framework
    var selectElements = document.querySelectorAll('select')
    window['M'].FormSelect.init(selectElements, {})

    // Init Model
    if (this.schema.model.type === 'py') {
      // Add loading indicator
      var overlay = document.createElement('div')
      overlay.id = 'overlay'
      overlay.className = 'valign-wrapper'
      overlay.innerHTML = `
        <div class="center-align" style="width:100%">
          <div class="preloader-wrapper small active">
            <div class="spinner-layer spinner-green-only">
              <div class="circle-clipper left">
                <div class="circle"></div>
              </div><div class="gap-patch">
                <div class="circle"></div>
              </div><div class="circle-clipper right">
                <div class="circle"></div>
              </div>
            </div>
          </div>
        </div>
      `
      this.inputsContainer.appendChild(overlay)

      let script = document.createElement('script')
      script.src = 'https://pyodide.cdn.iodide.io/pyodide.js'
      script.onload = () => {
        window['M'].toast({html: 'Loaded: Main framework'})
        window['languagePluginLoader'].then(() => {
          fetch(this.schema.model.url)
            .then(res => res.text())
            .then(res => {
              console.log('[Port] Loaded python code:', res)
              this.pymodel = res
              // Here we filter only import part to know load python libs
              let imports = res.split('\n').filter(str => (str.includes('import ')) && !(str.includes('#')) && !(str.includes(' js '))).join('\n')
              console.log('Imports: ', imports)
              window['pyodide'].runPythonAsync(imports, () => {})
                .then((res) => {
                  window['M'].toast({html: 'Loaded: Libs'})
                  this.inputsContainer.removeChild(overlay)
                })
                .catch((err) => {
                  console.log(err)
                  window['M'].toast({html: 'Error loading libs'})
                  this.inputsContainer.removeChild(overlay)
                })
            })
            .catch((err) => {
              console.log(err)
              window['M'].toast({html: 'Error loading python code'})
              this.inputsContainer.removeChild(overlay)
            })
        })
      }
      document.head.appendChild(script)
    } else if (['function', 'class', 'async-init', 'async-function'].includes(this.schema.model.type)) {
      // Initialize worker with the model
      if (this.schema.model.worker) {
        this.worker = new Worker('./worker-temp.js')

        if (this.schema.model.url) {
          fetch(this.schema.model.url)
            .then(res => res.text())
            .then(res => {
              console.log('[Port] Loaded js code')
              this.schema.model.code = res
              this.worker.postMessage(this.schema.model)
            })
        } else if (typeof this.schema.model.code !== 'undefined') {
          this.worker.postMessage(this.schema.model)
        } else {
          window['M'].toast({html: 'Error. No code provided'})
        }

        this.worker.onmessage = (e) => {
          const data = e.data
          console.log('[Port] Response from worker:', data)
          if ((typeof data === 'object') && (data._status)) {
            switch (data._status) {
              case 'loaded':
                window['M'].toast({html: 'Loaded: JS model (in worker)'})
                this.inputsContainer.removeChild(overlay)
                break
            }
          } else {
            this.output(data)
          }
        }
        this.worker.onerror = () => {
          console.log('[Port] Error from worker')
        }
      } else {
        // Initialize model in main window
        console.log('[Port] Init model in window')
        let script = document.createElement('script')
        script.src = this.schema.model.url
        script.onload = () => {
          window['M'].toast({html: 'Loaded: JS model'})
          console.log('[Port] Loaded JS model in main window')

          // Initializing the model (same in worker)
          if (this.schema.model.type === 'class') {
            console.log('[Port] Init class')
            const modelClass = new window[this.schema.model.name]()
            this.modelFunc = (...a) => {
              return modelClass[this.schema.model.method || 'predict'](...a)
            }
          } else if (this.schema.model.type === 'async-init') {
            console.log('[Port] Init function with promise')
            window[this.schema.model.name]().then((m) => {
              console.log('[Port] Async init resolved: ', m)
              this.modelFunc = m
            })
          } else {
            console.log('[Port] Init function')
            this.modelFunc = window[this.schema.model.name]
          }
        }
        document.head.appendChild(script)
      }
    } else if (this.schema.model.type === 'tf') {
      // Initialize TF
      let script = document.createElement('script')
      script.src = 'dist/tf.min.js'
      script.onload = () => {
        console.log('[Port] Loaded TF.js')
        window['tf'].loadLayersModel(this.schema.model.url).then(res => {
          console.log('[Port] Loaded Tensorflow model')
        })
      }
      document.head.appendChild(script)
    }
  }

  run () {
    const schema = this.schema
    console.log('[Port] Running the model')
    let inputValues
    if (schema.model && schema.model.container && schema.model.container === 'args') {
      console.log('[Port] Pass inputs as function arguments')
      inputValues = schema.inputs.map(input => {
        return input.element.getValue()
      })
    } else {
      console.log('[Port] Pass inputs in an object')
      inputValues = {}
      schema.inputs.forEach(input => {
        if (input.element) {
          inputValues[input.name] = input.element.getValue()
        }
      })
    }
    // We have all input values pass them to worker or tf
    console.log('[Port] Input values: ', inputValues)
    switch (schema.model.type) {
      case 'tf':
        break
      case 'py':
        /*
        const keys = Object.keys(inputValues)
        for (let key of keys) {
          window[key] = inputValues[key]
        }
        */
        window['inputs'] = inputValues
        window['pyodide'].runPythonAsync(this.pymodel, () => {})
          .then((res) => {
            this.output(res)
            // console.log(res)
            // window['M'].toast({html: 'Model and libs loaded'})
          })
          .catch((err) => {
            console.log(err)
            window['M'].toast({html: 'Error in code'})
          })
        break

      case 'class':
      case 'function':
      case 'async-init':
      case 'async-function':
        if (this.schema.model.worker) {
          this.worker.postMessage(inputValues)
        } else {
          // Run in main window
          var res
          if (this.schema.model.container === 'args') {
            res = this.modelFunc.apply(null, inputValues)
          } else {
            console.log('[Port] Applying inputs as object')
            res = this.modelFunc(inputValues)
          }
          console.log('[Port] modelFunc results:', res)
          Promise.resolve(res).then(r => { this.output(r) })
        }
        break
      case 'api':
        break
    }
  }

  _showOutput (value, output) {
    console.log('[Port] Show output: ', value, output)
    switch (output.type) {
      case 'file':
        let fileBlob = new Blob([value], {type: 'text/plain;charset=utf-8'})
        let a = document.createElement('a')
        a.className = 'waves-effect waves-light btn'
        a.innerText = 'Download'
        a.onclick = () => {
          FileSaver.saveAs(fileBlob, output.filename || 'output')
        }
        this.outputsContainer.appendChild(a)
        break
      case 'svg':
        // Append svg element
        let svgContainer = document.createElement('div')
        svgContainer.innerHTML = value
        this.outputsContainer.appendChild(svgContainer)

        // Append download button
        let svgBlob = new Blob([value], {type: 'text/plain;charset=utf-8'})
        let svgDownloadButton = document.createElement('a')
        svgDownloadButton.className = 'waves-effect waves-light btn'
        svgDownloadButton.innerText = 'Download'
        svgDownloadButton.onclick = () => {
          FileSaver.saveAs(svgBlob, 'code.svg')
        }
        this.outputsContainer.appendChild(svgDownloadButton)
        break
      default:
        let collection = document.createElement('ul')
        collection.className = 'collection'

        let collectionItem = document.createElement('li')
        collectionItem.className = 'collection-item port-collection-item'
        collectionItem.innerText = value
        collection.appendChild(collectionItem)

        if (output.name && output.name.length) {
          let spanElement = document.createElement('span')
          spanElement.className = 'badge port-badge'
          spanElement.innerText = output.name
          collectionItem.appendChild(spanElement)
        }

        this.outputsContainer.appendChild(collection)
    }
  }

  output (data) {
    // const blob = new Blob([file], { type: type || 'application/*' });
    // const file = window.URL.createObjectURL(blob)
    console.log('[Port] Got output results of type:', typeof data)
    console.log(data)

    this.outputsContainer.innerHTML = ''

    // TODO: Think about all edge cases
    // * No output field, but reactivity
    if ((this.schema.outputs && this.schema.outputs.length) || (typeof data === 'object')) {
      if (Array.isArray(data)) {
        let arrData
        if (data.length === this.schema.outputs.length) {
          arrData = data
        } else if (Array.isArray(data[0]) && (data[0].length === this.schema.outputs.length)) {
          arrData = data[0]
        }
        if (Array.isArray(arrData)) {
          this.schema.outputs.forEach((output, i) => {
            this._showOutput(arrData[i], output)
          })
        } else {
          this._showOutput(data, this.schema.outputs[0])
        }
      } else if (typeof data === 'object') {
        let updatedSomething = false
        if (this.schema.outputs) {
          this.schema.outputs.forEach((output, i) => {
            if (output.name && (typeof data[output.name] !== 'undefined')) {
              console.log('[Port] Show output: ', output.name)
              this._showOutput(data[output.name], output)
              updatedSomething = true
            }
          })
        }

        this.schema.inputs.forEach((input, i) => {
          console.log(input.name, data[input.name])
          if (input.name && (typeof data[input.name] !== 'undefined')) {
            console.log('[Port] Update input: ', input.name)
            const el = document.getElementById(input.name)
            const d = data[input.name]
            if (typeof d === 'object') {
              Object.keys(d).forEach(k => {
                if (k === 'options') {
                  while (el.length) {
                    el.remove(el.length - 1)
                  }
                  d[k].forEach(o => {
                    const option = document.createElement('option')
                    option.text = o
                    el.add(option)
                  })
                } else {
                  el[k] = d[k]
                }
              })
            } else {
              document.getElementById(input.name).value = d
            }
            // Fix labels stuck on top of inputs
            // https://stackoverflow.com/questions/54206131/changing-the-value-of-html-input-tag
            window['M'].updateTextFields()
            updatedSomething = true
          }
        })

        if (!updatedSomething) {
          let pre = document.createElement('pre')
          pre.innerText = JSON.stringify(data, null, 2)
          this.outputsContainer.appendChild(pre)
        }
      } else {
        this._showOutput(data, this.schema.outputs[0])
      }
    } else {
      // Output raw object
      let pre = document.createElement('pre')
      pre.innerText = JSON.stringify(data, null, 2)
      this.outputsContainer.appendChild(pre)
    }
  }
}

module.exports = Port
