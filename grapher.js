var GRAPHER = (function($, _) {
    "use strict";
    var grapher = {};
    var canvasTimerId;
    var controlPoints = [];
    var selectedPoint = -1;
    var graphPadding = 20;
    var controlPointRadius = 5;
    var mousePos = {x: -1, y: -1};
    var leftButtonDown = false;
    var canvasWidth, canvasHeight;
    var canvasWidthEffective = canvasWidth - graphPadding;
    var canvasHeightEffective = canvasHeight - graphPadding;
    var lostFocus;
    var xMin = 0, xMax = 100;
    var yMin = 0, yMax = 5;
    var dirtyFlag = true;
    var drawApprox = false;
    var numApproxSteps = 1;
    var func;
    var funcCache = [];

    var particleTimerId;
    var particleSize = 32;

    function dot4(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    }

    function CatmullRom(t, p0, p1, p2, p3) {
        var t2 = t*t;
        var t3 = t2*t;
        var p = [p0, p1, p2, p3];

        var a = dot4(p, [ 0,  2,  0,  0]);
        var b = dot4(p, [-1,  0,  1,  0]);
        var c = dot4(p, [ 2, -5,  4, -1]);
        var d = dot4(p, [-1,  3, -3,  1]);

        return 0.5 * dot4([1, t, t2, t3], [a, b, c, d]);
    }

    function setFont(ctx, font, textBaseline, textAlign) {
        ctx.font = font;
        ctx.textBaseline = textBaseline;
        ctx.textAlign = textAlign;
    }

    function drawFuncApprox(approx) {
        var canvas = $('#graph-canvas').get(0);
        var ctx = canvas.getContext('2d');
        ctx.beginPath();

        var numSteps = approx.length;
        for (var i = 0; i < numSteps; ++i) {
            var x = xMin + i * (xMax - xMin) / (numSteps - 1);
            var y = approx[i];
            var c = worldToCanvas({x: x, y:y});
            if (i > 0)
                ctx.lineTo(c.x, c.y);
            ctx.moveTo(c.x, c.y);
        }

        ctx.closePath();
        ctx.stroke();
    }

    function evalAtPoint(curPt, t) {
        var numPts = controlPoints.length;
        var p0 = controlPoints[Math.max(0, curPt-1)];
        var p1 = controlPoints[curPt];
        var p2 = controlPoints[Math.min(numPts-1, curPt+1)];
        var p3 = controlPoints[Math.min(numPts-1, curPt+2)];

        var localT = (t - p1.x) / (p2.x - p1.x);
        var y = CatmullRom(localT, p0.y, p1.y, p2.y, p3.y);
        return y;
    }

    function splineAtTime(t) {
        var numPts = controlPoints.length;
        if (numPts == 0)
            return 0;

        var curPt = 0;
        if (t < controlPoints[0].x) {
            return controlPoints[0].y;
        } else if (t > _.last(controlPoints).x) {
            return _.last(controlPoints).y;
        } else {
            while (t > controlPoints[curPt+1].x && curPt < numPts)
                curPt++;
            return evalAtPoint(curPt, t);
        }
    }

    function evalSpline(steps) {
        var res = [];
        var numPts = controlPoints.length;
        if (numPts < 4)
            return res;

        var curPt = 0;
        for (var i = 0; i < steps; ++i) {
            var t = xMin + i * (xMax - xMin) / (steps - 1);

            if (t < controlPoints[0].x) {
                res.push(controlPoints[0].y);
            } else if (t > _.last(controlPoints).x) {
                res.push(_.last(controlPoints).y);
            } else {
                while (t > controlPoints[curPt+1].x && curPt < numPts)
                    curPt++;

                var y = evalAtPoint(curPt, t);
                res.push(y);
            }
        }
        return res;
    }

    function drawParticle() {
        var canvas = $('#particle-canvas').get(0);
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);

        var r = particleSize/2;
        for (var i = -r; i < r; ++i) {
            for (var j = -r; j < r; ++j) {
                var dx = Math.abs(i/r);
                var dy = Math.abs(j/r);
                var d = Math.sqrt(dx*dx+dy*dy);
                var c = d <= 1 ? 255 * splineAtTime(xMin + d*(xMax - xMin)) : 0;
                c = Math.max(0, Math.min(255, c));
                ctx.fillStyle = "rgba(" + c.toFixed(0) + "," + c.toFixed(0) + "," + c.toFixed(0) + "," + c.toFixed(0) + ")";
                ctx.fillRect(j+particleSize/2, i+particleSize/2, 1, 1);
            }
        }

    }

    function drawCanvas() {

        var canvas = $('#graph-canvas').get(0);
        var ctx = canvas.getContext('2d');
        var w = canvas.width;
        var h = canvas.height;

        var drawBackground = function() {
            ctx.fillStyle = "#888";
            ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = "#444";
            ctx.beginPath();
            var spanX = canvasWidth - graphPadding;
            var vertLines = 10;
            for (var i = 0; i < vertLines; ++i) {
                var x = -0.5 + graphPadding + Math.floor(i * spanX / (vertLines-1));
                ctx.moveTo(x, 0);
                ctx.lineTo(x, i == 0 ? h : h - graphPadding);
            }

            var spanY = canvasHeight - graphPadding;
            var horizLines = 5;
            for (i = 0; i < horizLines; ++i) {
                var y = -0.5 + Math.floor(i * spanY / (horizLines-1));
                ctx.moveTo(i == (horizLines-1) ? 0 : graphPadding, y);
                ctx.lineTo(canvasWidth, y);
            }
            ctx.closePath();
            ctx.stroke();
        }();

        var drawControlPoints = function() {
            ctx.fillStyle = "#000";
            $.each(controlPoints, function(i, pt) {
                ctx.beginPath();
                ctx.fillStyle = (i == selectedPoint) ? "#ee5" : "#000";
                var c = worldToCanvas(pt);
                ctx.arc(c.x, c.y, controlPointRadius, 0, 2 * Math.PI, false);
                ctx.closePath();
                ctx.fill();
            });
        }();

        var drawSpline = function() {
            var numPts = controlPoints.length;
            if (numPts < 4)
                return;
            ctx.strokeStyle = "#000";
            for (var i = 0; i < numPts-1; ++i) {
                ctx.beginPath();
                var p0 = controlPoints[Math.max(0, i-1)];
                var p1 = controlPoints[i];
                var p2 = controlPoints[i+1];
                var p3 = controlPoints[Math.min(numPts-1, i+2)];
                for (var t = 0; t < 20; ++t) {
                    var x = p1.x + (p2.x - p1.x) * t / 19;
                    var y = CatmullRom(t/19.0, p0.y, p1.y, p2.y, p3.y);
                    var c = worldToCanvas({x: x, y:y});
                    if (t > 0)
                        ctx.lineTo(c.x, c.y);
                    ctx.moveTo(c.x, c.y);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }();

        drawFuncApprox(evalSpline(numApproxSteps));

        var drawFunc = function() {
            if (!func)
                return;
            try {
                if (dirtyFlag)
                    funcCache = [];
                ctx.strokeStyle = "#840";
                var numSteps = canvasWidth/2;
                ctx.beginPath();
                for (var i = 0; i < numSteps; ++i) {
                    var y;
                    if (dirtyFlag) {
                        y = eval(func);
                        funcCache[i] = y;
                    } else {
                        y = funcCache[i];
                    }
                    var t = xMin + i * (xMax - xMin) / (numSteps-1);
                    var c = worldToCanvas({x: t, y:y});
                    if (i > 0)
                        ctx.lineTo(c.x, c.y);
                    ctx.moveTo(c.x, c.y);
                }
                ctx.closePath();
                ctx.stroke();
            } catch(e) {
                func = null;
            }
        }();

        var drawLabels = function() {

            setFont(ctx, "12px Arial", "top", "right");
            ctx.fillStyle = "#000";
            ctx.fillText(yMax, graphPadding - 2, 2);
            ctx.fillText(yMin, graphPadding - 2, canvasHeight - graphPadding + 2);
            ctx.textAlign = "left";
            ctx.fillText(xMin, graphPadding + 2, canvasHeight - graphPadding + 2);
            ctx.textAlign = "right";
            ctx.fillText(xMax, canvasWidth - 2, canvasHeight - graphPadding + 2);
        }();

        dirtyFlag = false;
    };

    function clientToWorld(e) {
        // convert points to client normlized([0,1]x[0,1])
        var canvas = $('#graph-canvas');
        var ofs = canvas.offset();
        var w = canvasWidth - graphPadding;
        var h = canvasHeight - graphPadding;
        var clientNorm = {x:(e.clientX - ofs.left - graphPadding) / w, y:(e.clientY - ofs.top) / h};

        // and to world coords
        return { x: xMin + (xMax - xMin) * clientNorm.x, y: yMin + (yMax - yMin) * (1 - clientNorm.y) };
    }

    function worldToCanvas(pt) {
        var canvas = $('#graph-canvas');
        var ofs = canvas.offset();

        // to client normalized
        var w = xMax - xMin;
        var h = yMax - yMin;
        var clientNorm = { x: (pt.x - xMin) / w, y: (pt.y - yMin) / h };

        return {
            x: graphPadding + clientNorm.x * canvasWidthEffective,
            y: (1-clientNorm.y) * canvasHeightEffective};
    }

    function mouseUp(e) {
        leftButtonDown = !(e.which == 1);
        if (lostFocus) {
            lostFocus = false;
            return;
        }

        var pt = clientToWorld(e);
        var idx = ptInControlPoint(pt);
        if (idx == -1) {
            var numPts = controlPoints.length;
            if (numPts == 0 || pt.x > _.last(controlPoints).x ) {   // insert first or last
                controlPoints.push(pt);
            } else {
                for (var i = 0; i < numPts; ++i) {
                    if (pt.x < controlPoints[i].x) {
                        // insert the control points at the right position
                        controlPoints = _.first(controlPoints, i).concat(pt, _.last(controlPoints, numPts-i));
                        return;
                    }
                }
            }
        }
    }

    function ptInControlPoint(pt) {
        var res = -1;
        $.each(controlPoints, function(i, ctrlPt) {
            var dx = pt.x - ctrlPt.x;
            var dy = pt.y - ctrlPt.y;
            var ex = controlPointRadius / canvasWidth * (xMax - xMin);
            var ey = controlPointRadius / canvasHeight * (yMax - yMin);
            if (Math.sqrt(dx*dx) < ex && Math.sqrt(dy*dy) < ey) {
                res = i;
                return false;
            }
        });
        return res;
    }

    function mouseDown(e) {
        leftButtonDown = (e.which == 1);
        var pt = clientToWorld(e);
        var idx = ptInControlPoint(pt);
        selectedPoint = idx;
    }

    function mouseMove(e) {
        mousePos = clientToWorld(e);
        if (leftButtonDown && selectedPoint != -1) {
            // don't allow moving past the next point
            var numPts = controlPoints.length;
            if (numPts > 1)                    {
                var min = selectedPoint == 0 ? 0 : controlPoints[selectedPoint-1].x;
                var max = selectedPoint == numPts -1 ? canvasWidth - graphPadding: controlPoints[selectedPoint+1].x;
                var x = Math.max(min, Math.min(max, mousePos.x));
                controlPoints[selectedPoint] = {x:x, y:mousePos.y};
            } else {
                controlPoints[selectedPoint] = clientToWorld(e);
            }
        }
    }

    function mouseLeave(e) {
        mousePos = {x: -1, y: -1};
        leftButtonDown = false;
        selectedPoint = -1;
        lostFocus = true;
    }

    function keyDown(e) {
        if (e.keyCode == 27) {  // ESC
            selectedPoint = -1;
            return false;
        } else if (e.keyCode == 46) { // del
            var idx = ptInControlPoint(mousePos);
            if (idx != -1) {
                controlPoints.splice(idx, 1);
                selectedPoint = -1;
            }
        }
    }

    grapher.generateCode = function(steps) {
        numApproxSteps = steps;
        var res = evalSpline(steps);
        res = _.map(res, function(x) {return x.toFixed(4) + "f"});
        var json = JSON.stringify(controlPoints);
        $("#graphCode").attr("value",
            "float " + $("#graphName").attr("value") + "[" + steps + "] = {" + res.join() + "};" + "\n" +
            "/*" + json + "*/");
        $("#graphJson").attr("value", json);
    };

    grapher.setDimensions = function(x0, x1, y0, y1) {
        xMin = x0;
        xMax = x1;
        yMin = y0;
        yMax = y1;
        dirtyFlag = true;
    };

    grapher.getDimensions = function() {
        return {x0: xMin, x1: xMax, y0: yMin, y1: yMax };
    };

    grapher.setFunc = function(f) {
        func = f;
        dirtyFlag = true;
    };

    grapher.JsonImport = function(j) {
        controlPoints = JSON.parse(j);
    };

    grapher.setParticleSize = function(s) {
        particleSize = s;
    };

    grapher.init = function() {
        var canvas = $('#graph-canvas');
        var cont = $("#container");
        canvasWidth = canvas.width();
        canvasHeight = canvas.height();
        canvasHeightEffective = canvasHeight - graphPadding;
        canvasWidthEffective = canvasWidth - graphPadding;
        canvas.mouseup(mouseUp);
        canvas.mousedown(mouseDown);
        canvas.mousemove(mouseMove);
        canvas.mouseleave(mouseLeave);
        $(document).keypress(keyDown);
        canvasTimerId = setInterval(drawCanvas, 100);
        particleTimerId = setInterval(drawParticle, 100);
    };

    return grapher;
}(window.jQuery, window._));

