define([
  'lib/glMatrix',
  'lib/Hammer',
  'misc/Utils',
  'Scene',
  'mesh/multiresolution/Multimesh'
], function (glm, Hammer, Utils, Scene, Multimesh) {

  'use strict';

  // Manage events
  var SculptGL = function () {
    Scene.call(this);

    // controllers stuffs
    this.mouseX_ = 0;
    this.mouseY_ = 0;
    this.lastMouseX_ = 0;
    this.lastMouseY_ = 0;
    this.lastScale_ = 0;
    this.mouseButton_ = 0;
    this.lastNbPointers_ = 0;

    // masking
    this.checkMask_ = false;
    this.maskX_ = 0;
    this.maskY_ = 0;
    this.hammer_ = new Hammer.Manager(this.canvas_);

    this.eventProxy_ = {};

    this.initHammer();
    this.addEvents();
  };

  SculptGL.prototype = {
    initHammer: function () {
      this.initHammerRecognizers();
      this.initHammerEvents();
    },
    initHammerRecognizers: function () {
      var hm = this.hammer_;
      // double tap
      hm.add(new Hammer.Tap({
        event: 'doubletap',
        taps: 2,
        time: 250, // def : 250.  Maximum press time in ms.
        interval: 450, // def : 300. Maximum time in ms between multiple taps.
        threshold: 5, // def : 2. While doing a tap some small movement is allowed.
        posThreshold: 50 // def : 30. The maximum position difference between multiple taps.
      }));

      // pan
      hm.add(new Hammer.Pan({
        event: 'pan',
        pointers: 0,
        threshold: 0,
      }));

      // pinch
      hm.add(new Hammer.Pinch({
        event: 'pinch',
        pointers: 2,
        threshold: 0.1 // Set a minimal thresold on pinch event, to be detected after pan
      }));
      hm.get('pinch').recognizeWith(hm.get('pan'));
    },
    initHammerEvents: function () {
      var hm = this.hammer_;
      hm.on('panstart', this.onPanStart.bind(this));
      hm.on('panmove', this.onPanMove.bind(this));
      hm.on('panend pancancel', this.onPanEnd.bind(this));

      hm.on('doubletap', this.onDoubleTap.bind(this));
      hm.on('pinchstart', this.onPinchStart.bind(this));
      hm.on('pinchin pinchout', this.onPinchInOut.bind(this));
    },
    onPanStart: function (e) {
      if (e.pointerType === 'mouse')
        return;
      this.focusGui_ = false;
      var evProxy = this.eventProxy_;
      evProxy.pageX = e.center.x;
      evProxy.pageY = e.center.y;
      this.lastNbPointers_ = evProxy.which = Math.min(2, e.pointers.length);
      this.onDeviceDown(evProxy);
    },
    onPanMove: function (e) {
      if (e.pointerType === 'mouse')
        return;
      var evProxy = this.eventProxy_;
      evProxy.pageX = e.center.x;
      evProxy.pageY = e.center.y;
      var nbPointers = Math.min(2, e.pointers.length);
      if (nbPointers !== this.lastNbPointers_) {
        this.onDeviceUp();
        evProxy.which = nbPointers;
        this.onDeviceDown(evProxy);
        this.lastNbPointers_ = nbPointers;
      }
      this.onDeviceMove(evProxy);
    },
    onPanEnd: function (e) {
      if (e.pointerType === 'mouse')
        return;
      this.onDeviceUp();
    },
    onDoubleTap: function (e) {
      if (!this.isReplayed()) {
        if (this.focusGui_)
          return;
        var evProxy = this.eventProxy_;
        evProxy.pageX = e.center.x;
        evProxy.pageY = e.center.y;
        this.setMousePosition(evProxy);
      }
      var mouseX = this.mouseX_;
      var mouseY = this.mouseY_;
      if (!this.isReplayed())
        this.getReplayWriter().pushAction('DOUBLE_TAP', mouseX, mouseY);

      var picking = this.picking_;
      var res = picking.intersectionMouseMeshes(this.meshes_, mouseX, mouseY);
      var cam = this.camera_;
      var pivot = [0.0, 0.0, 0.0];
      if (!res) {
        var diag = 70.0;
        if (this.meshes_.length > 0) {
          var box = this.computeBoundingBoxMeshes(this.meshes_);
          diag = 0.8 * glm.vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
        }
        cam.setPivot(pivot);
        cam.moveAnimationTo(cam.offset_[0], cam.offset_[1], diag, this);
      } else {
        glm.vec3.transformMat4(pivot, picking.getIntersectionPoint(), picking.getMesh().getMatrix());
        cam.setPivot(pivot);
        cam.moveAnimationTo(cam.offset_[0], cam.offset_[1], 20.0, this);
      }
      this.render();
    },
    onPinchStart: function (e) {
      this.focusGui_ = false;
      this.lastScale_ = e.scale;
    },
    onPinchInOut: function (e) {
      var dir = (e.scale - this.lastScale_) * 25;
      this.lastScale_ = e.scale;
      dir = new Float32Array([dir])[0]; // f32 cast for sgl exporter consistency
      this.onDeviceWheel(dir);
    },
    addEvents: function () {
      this.hammer_.options.enable = true;
      var canvas = this.canvas_;

      var cbMouseMove = Utils.throttle(this.onMouseMove.bind(this), 16.66);
      var cbMouseDown = this.onMouseDown.bind(this);
      var cbMouseUp = this.onMouseUp.bind(this);
      var cbMouseOut = this.onMouseOut.bind(this);
      var cbMouseOver = this.onMouseOver.bind(this);
      var cbMouseWheel = this.onMouseWheel.bind(this);

      // mouse
      canvas.addEventListener('mousedown', cbMouseDown, false);
      canvas.addEventListener('mouseup', cbMouseUp, false);
      canvas.addEventListener('mouseout', cbMouseOut, false);
      canvas.addEventListener('mouseover', cbMouseOver, false);
      canvas.addEventListener('mousemove', cbMouseMove, false);
      canvas.addEventListener('mousewheel', cbMouseWheel, false);
      canvas.addEventListener('DOMMouseScroll', cbMouseWheel, false);

      var cbContextLost = this.onContextLost.bind(this);
      var cbContextRestored = this.onContextRestored.bind(this);
      var cbLoadFiles = this.loadFiles.bind(this);
      var cbStopAndPrevent = this.stopAndPrevent.bind(this);

      // misc
      canvas.addEventListener('webglcontextlost', cbContextLost, false);
      canvas.addEventListener('webglcontextrestored', cbContextRestored, false);
      window.addEventListener('dragenter', cbStopAndPrevent, false);
      window.addEventListener('dragover', cbStopAndPrevent, false);
      window.addEventListener('drop', cbLoadFiles, false);
      document.getElementById('fileopen').addEventListener('change', cbLoadFiles, false);

      this.removeCallback = function () {
        this.hammer_.options.enable = false;

        // mouse
        canvas.removeEventListener('mousedown', cbMouseDown, false);
        canvas.removeEventListener('mouseup', cbMouseUp, false);
        canvas.removeEventListener('mouseout', cbMouseOut, false);
        canvas.removeEventListener('mouseover', cbMouseOver, false);
        canvas.removeEventListener('mousemove', cbMouseMove, false);
        canvas.removeEventListener('mousewheel', cbMouseWheel, false);
        canvas.removeEventListener('DOMMouseScroll', cbMouseWheel, false);

        // misc
        canvas.removeEventListener('webglcontextlost', cbContextLost, false);
        canvas.removeEventListener('webglcontextrestored', cbContextRestored, false);
        window.removeEventListener('dragenter', cbStopAndPrevent, false);
        window.removeEventListener('dragover', cbStopAndPrevent, false);
        window.removeEventListener('drop', cbLoadFiles, false);
        document.getElementById('fileopen').removeEventListener('change', cbLoadFiles, false);
      };
    },
    stopAndPrevent: function (event) {
      event.stopPropagation();
      event.preventDefault();
    },
    removeEvents: function () {
      if (this.removeCallback) this.removeCallback();
    },
    /** Return the file type */
    getFileType: function (name) {
      var lower = name.toLowerCase();
      if (lower.endsWith('.obj')) return 'obj';
      if (lower.endsWith('.sgl')) return 'sgl';
      if (lower.endsWith('.stl')) return 'stl';
      if (lower.endsWith('.ply')) return 'ply';
      if (lower.endsWith('.rep')) return 'rep';
      return;
    },
    /** Load file */
    loadFiles: function (event) {
      event.stopPropagation();
      event.preventDefault();
      var files = event.dataTransfer ? event.dataTransfer.files : event.target.files;
      for (var i = 0, nb = files.length; i < nb; ++i) {
        var file = files[i];
        var fileType = this.getFileType(file.name);
        this.readFile(file, fileType);
        if (fileType === 'rep')
          return;
      }
    },
    readFile: function (file, ftype) {
      var fileType = ftype || this.getFileType(file.name);
      if (!fileType)
        return;

      var reader = new FileReader();
      var self = this;
      reader.onload = function (evt) {
        if (fileType === 'rep')
          self.getReplayReader().import(evt.target.result, null, file.name.substr(0, file.name.length - 4));
        else
          self.loadScene(evt.target.result, fileType, self.autoMatrix_);
        document.getElementById('fileopen').value = '';
      };

      if (fileType === 'obj')
        reader.readAsText(file);
      else
        reader.readAsArrayBuffer(file);
    },
    onContextLost: function () {
      window.alert('Oops... WebGL context lost.');
    },
    onContextRestored: function () {
      window.alert('Wow... Context is restored.');
    },
    onMouseOver: function () {
      this.focusGui_ = false;
    },
    onMouseOut: function (event) {
      this.focusGui_ = true;
      this.onMouseUp(event);
    },
    onMouseUp: function (event) {
      event.preventDefault();
      this.onDeviceUp();
    },
    onDeviceUp: function () {
      if (!this.isReplayed())
        this.getReplayWriter().pushDeviceUp();

      this.canvas_.style.cursor = 'default';
      this.mouseButton_ = 0;
      Multimesh.RENDER_HINT = Multimesh.NONE;
      this.sculpt_.end();
      if (this.checkMask_) {
        this.checkMask_ = false;
        if (this.mesh_) {
          if (this.lastMouseX_ === this.maskX_ && this.lastMouseY_ === this.maskY_)
            this.getSculpt().getTool('MASKING').invert(this.mesh_, this);
          else
            this.getSculpt().getTool('MASKING').clear(this.mesh_, this);
        }
      }
      this.render();
    },
    onMouseWheel: function (event) {
      event.stopPropagation();
      event.preventDefault();
      var dir = event.wheelDelta === undefined ? -event.detail : event.wheelDelta;
      this.onDeviceWheel(dir > 0 ? 1 : -1);
    },
    onDeviceWheel: function (dir) {
      if (!this.isReplayed())
        this.getReplayWriter().pushAction('DEVICE_WHEEL', dir);

      this.camera_.zoom(dir * 0.02);
      Multimesh.RENDER_HINT = Multimesh.CAMERA;
      this.render();
      // workaround for "end mouse wheel" event
      if (this.timerEndWheel_)
        window.clearTimeout(this.timerEndWheel_);
      this.timerEndWheel_ = window.setTimeout(this.endWheel.bind(this), 300);
    },
    endWheel: function () {
      Multimesh.RENDER_HINT = Multimesh.NONE;
      this.render();
    },
    setMousePosition: function (event) {
      this.mouseX_ = event.pageX - this.canvas_.offsetLeft;
      this.mouseY_ = event.pageY - this.canvas_.offsetTop;
    },
    onMouseDown: function (event) {
      event.stopPropagation();
      event.preventDefault();
      this.onDeviceDown(event);
    },
    onMouseMove: function (event) {
      event.stopPropagation();
      event.preventDefault();
      this.onDeviceMove(event);
    },
    onDeviceDown: function (event) {
      if (!this.isReplayed()) {
        if (this.focusGui_)
          return;
        this.setMousePosition(event);
      }
      var mouseX = this.mouseX_;
      var mouseY = this.mouseY_;
      var button = this.mouseButton_ = event.which;

      if (!this.isReplayed())
        this.getReplayWriter().pushDeviceDown(button, mouseX, mouseY, event);

      if (button === 1)
        this.sculpt_.start(this, event.shiftKey);
      var picking = this.picking_;
      var pickedMesh = picking.getMesh();
      if (button === 1 && pickedMesh)
        this.canvas_.style.cursor = 'none';

      this.checkMask_ = false;
      if (button === 3 && event.ctrlKey)
        this.mouseButton_ = 4; // zoom camera
      else if (button === 2)
        this.mouseButton_ = 5; // pan camera (wheel mode)
      else if (!pickedMesh && event.ctrlKey) {
        this.maskX_ = mouseX;
        this.maskY_ = mouseY;
        this.checkMask_ = true;
        this.mouseButton_ = 0; // mask edit mode
      } else if ((!pickedMesh || button === 3) && event.altKey)
        this.mouseButton_ = 2; // pan camera
      else if (button === 3 || (button === 1 && !pickedMesh)) {
        this.mouseButton_ = 3; // rotate camera
      }
      // zoom or rotate camera
      if (this.mouseButton_ === 3 || this.mouseButton_ === 4) {
        if (this.camera_.usePivot_)
          picking.intersectionMouseMeshes(this.meshes_, mouseX, mouseY);
        this.camera_.start(mouseX, mouseY, picking);
      }

      this.lastMouseX_ = mouseX;
      this.lastMouseY_ = mouseY;
    },
    onDeviceMove: function (event) {
      if (!this.isReplayed()) {
        if (this.focusGui_)
          return;
        this.setMousePosition(event);
      }
      var mouseX = this.mouseX_;
      var mouseY = this.mouseY_;
      var button = this.mouseButton_;

      if (!this.isReplayed())
        this.getReplayWriter().pushDeviceMove(mouseX, mouseY, event);

      if (button !== 1 || this.sculpt_.allowPicking()) {
        Multimesh.RENDER_HINT = Multimesh.PICKING;
        if (this.mesh_ && button === 1)
          this.picking_.intersectionMouseMesh(this.mesh_, mouseX, mouseY);
        else
          this.picking_.intersectionMouseMeshes(this.meshes_, mouseX, mouseY);
        if (this.sculpt_.getSymmetry() && this.mesh_)
          this.pickingSym_.intersectionMouseMesh(this.mesh_, mouseX, mouseY);
      }
      if (button !== 0) {
        if (button === 4 || (button === 2 && !event.altKey)) {
          this.camera_.zoom((mouseX - this.lastMouseX_ + mouseY - this.lastMouseY_) / 1000);
          Multimesh.RENDER_HINT = Multimesh.CAMERA;
          this.render();
        } else if (button === 2 || button === 5) {
          this.camera_.translate((mouseX - this.lastMouseX_) / 1000, (mouseY - this.lastMouseY_) / 1000);
          Multimesh.RENDER_HINT = Multimesh.CAMERA;
          this.render();
        } else if (button === 3) {
          if (event.shiftKey) this.camera_.snapClosestRotation();
          else this.camera_.rotate(mouseX, mouseY);
          Multimesh.RENDER_HINT = Multimesh.CAMERA;
          this.render();
        } else if (button === 1) {
          Multimesh.RENDER_HINT = Multimesh.SCULPT;
          this.sculpt_.update(this);
          if (this.getMesh().getDynamicTopology)
            this.gui_.updateMeshInfo();
        }
      }
      this.lastMouseX_ = mouseX;
      this.lastMouseY_ = mouseY;
      this.renderSelectOverRtt();
    }
  };

  Utils.makeProxy(Scene, SculptGL);

  return SculptGL;
});