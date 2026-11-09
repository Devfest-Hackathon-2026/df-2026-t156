mergeInto(LibraryManager.library, {
    OrbitCanvasDensity: function () {
        var canvas = Module.canvas;
        return canvas.width / Math.max(1, canvas.clientWidth);
    }
});
