function main(options) {
    var edlFile;
    edlFile = File.openDialog('Select an EDL file');
    if (!edlFile) {
        alert('No file selected!');
        return;
    }

    function parseEDL(edlFile) {
        edlFile.open('r');
        var lines = edlFile.read().split('\n');
        edlFile.close();

        // Remove last row (expected to be blank)
        lines.pop(); // TODO: Check whether last row is blank

        var colNames = lines.shift().replace(/"/g, '').split(';');

        var edl = []; // Array of clips (aka "reels")
        for (var rowIndex = 0; rowIndex < lines.length; rowIndex++) { 
            var cols = lines[rowIndex].replace(/"/g, '').split('; ');
            edl.push({});
            for (var colIndex = 0; colIndex < cols.length; colIndex++) { 
                var field = colNames[colIndex];
                edl[rowIndex][field] = cols[colIndex];
                continue;
            }
        }

        // perhaps have a dictionary of field names and functions to both cast and convert (e.g secs to ms)
        var floatFields = [
            // "Length", // This is just StreamLength cast to int
            'StartTime', 
            'StreamStart',
            'StreamLength',
            'PlayRate',
            'PlayPitch',
            'FadeTimeIn',
            'FadeTimeOut'
        ];

        for (var i = 0; i < floatFields.length; i++) {
            for (var j = 0; j < edl.length; j++) {
                edl[j][floatFields[i]] = parseFloat(edl[j][floatFields[i]]);
            }
        }

        return edl;
    }

    var edl = parseEDL(edlFile);
    if (options['reverseLayerOrder'])
        edl.reverse();

    var compBaseDuration = 1; // Subtracted later // Default for now, must be calculated
    var comp = app.project.items.addComp(
        edlFile.name.split('.txt')[0],
        options.compWidth,
        options.compHeight,
        options.compPixelAspect,
        compBaseDuration,
        options.compFrameRate
    );

    var failedImports = {};
    var ignoreFailedImports = false;

    function getPlaceholder(edlClip) {
        return app.project.importPlaceholder(
            edlClip.FileName,
            options['compWidth'],
            options['compHeight'],
            options['compFrameRate'],
            edlClip.StreamLength / 1000
        )
    }

    function getSolid(edlClip, solidColorHex) {
        edlClip.FileName = 'Solid';
        var footageItem = getPlaceholder(edlClip);
        function hexToFloats(hex) {
            hex = hex.replace(/^#/, '');
            if (!(hex.length !== 3 || hex.length !== 6))
                alert('Invalid hex code!');
            if (hex.length === 3) // Expand shorthand (e.g., #abc -> #aabbcc)
              hex = hex.split('').map(function(c) {return c + c}).join('');
            var r = parseInt(hex.substring(0, 2), 16) / 255;
            var g = parseInt(hex.substring(2, 4), 16) / 255;
            var b = parseInt(hex.substring(4, 6), 16) / 255;
            return [r, g, b];
        }
        footageItem.replaceWithSolid(
            hexToFloats(solidColorHex),
            'Solid',
            options['compWidth'],
            options['compHeight'],
            options['compPixelAspect']
        );
        return footageItem;
    }

    function findFootageItem(edlClip, clipFile) {
        // Project items are indexed from 1
        for (var j = 1; j <= app.project.numItems; j++) {
            var projectItem = app.project.items[j];
            // Solids have no FileName
            if (!edlClip.FileName && projectItem instanceof SolidSource)
                return projectItem;
            else if (projectItem.file && projectItem.file.fullName === clipFile.fullName)
                return projectItem;
        }
    }

    function importFootage(edlClip) {
        var clipFile = File(edlClip.FileName);
        var footageItem = findFootageItem(edlClip, clipFile);

        if (footageItem)
            return footageItem;

        if (!edlClip.FileName)
            return getSolid(edlClip, options['solidColorHex']);
        else if (clipFile.exists)
            return app.project.importFile(new ImportOptions(clipFile));
        else {
            if (!ignoreFailedImports) {
                ignoreFailedImports = Window.confirm(
                    'Failed to import file:\n' + edlClip.FileName +
                    '\nA placeholder will be used instead.' +
                    '\n\nPress OK to suppress this warning.'
                );
            }
            return getPlaceholder(edlClip);
        }
    }

    for (var clipIndex = 0; clipIndex < edl.length; clipIndex++) {
        var clip = edl[clipIndex];
        if (failedImports[clip.FileName])
            continue;
        var footageItem = importFootage(clip);
        var layer = comp.layers.add(footageItem);

        // Trim points (offset by 1 frame for correct positioning)
        layer.inPoint = (clip.StreamStart / 1000) + comp.frameDuration;
        layer.outPoint = (clip.StreamStart + clip.StreamLength) / 1000 + comp.frameDuration;
        
        // Timeline position
        layer.startTime = (clip.StartTime / 1000) - layer.inPoint;

        layer.stretch = clip.PlayRate * 100; // Time stretch
        layer.label = (clipIndex + 1) % 16; // Layer color

        function applyFades(clip, layer, propHandle) {
            function getKeyframeEase(curveType) {
                var easeIn;
                var easeOut;

                if (curveType == 1) { // Linear
                    return null;
                } else if (curveType == -2) { // Slow in, fast out
                    easeIn = new KeyframeEase(0, 75);
                    easeOut = new KeyframeEase(0, 0.1);
                } else if (curveType == 2) { // Fast in, slow out
                    easeIn = new KeyframeEase(0, 0.1);
                    easeOut = new KeyframeEase(0, 75);
                } else if (curveType == 4) { // Easy Ease
                    easeIn = new KeyframeEase(0, 33.33);
                    easeOut = easeIn;
                } else if (curveType == -4) { // Inverted Easy Ease                    
                    easeIn = new KeyframeEase(100, 5);
                    easeOut = easeIn;
                } else {
                    alert('Unregistered CurveType: ' + curveType);
                }

                return easeIn && easeOut ? [easeIn, easeOut] : null;
            }

            var minValue = 0;
            var maxValue = 100;

            if (clip.FadeTimeIn > 0) {
                var fadeStart = layer.inPoint;
                var fadeEnd = fadeStart + (clip.FadeTimeIn / 1000);
                propHandle.setValueAtTime(fadeStart, minValue);
                propHandle.setValueAtTime(fadeEnd, maxValue);
                
                var easeArgs = getKeyframeEase(clip.CurveIn);
                if (easeArgs) {
                    propHandle.setTemporalEaseAtKey(1, [easeArgs[0]]);
                    propHandle.setTemporalEaseAtKey(2, [easeArgs[1]]);
                }

                if (options['markKeyframes']) { 
                    var marker = new MarkerValue("Fade In");
                    marker.duration = fadeEnd - fadeStart;
                    layer.marker.setValueAtTime(fadeStart, marker);
                }
            }

            if (clip.FadeTimeOut > 0) {
                var fadeStart = layer.outPoint - (clip.FadeTimeOut / 1000);
                var fadeEnd = layer.outPoint;
                
                propHandle.setValueAtTime(fadeStart, maxValue);
                propHandle.setValueAtTime(fadeEnd, minValue);

                var easeArgs = getKeyframeEase(clip.CurveOut);
                if (easeArgs) {
                    propHandle.setTemporalEaseAtKey(propHandle.numKeys - 1, [easeArgs[0]]);
                    propHandle.setTemporalEaseAtKey(propHandle.numKeys, [easeArgs[1]]);
                };

                if (options['markKeyframes']) {
                    var marker = new MarkerValue("Fade Out");
                    marker.duration = fadeEnd - fadeStart;
                    layer.marker.setValueAtTime(fadeStart, marker);
                }
            }
        }

        var mediaType = clip.MediaType.toLowerCase();
        if (mediaType === 'audio') { 
            layer.enabled = false; // Disables video
            var mixer = layer.Effects.addProperty('Stereo Mixer');
            applyFades(clip, layer, mixer['Left Level']); 
            applyFades(clip, layer, mixer['Right Level']);
        } else if (mediaType === 'video') {
            layer.audioEnabled = false; // Disables audio
            applyFades(clip, layer, layer['opacity']);  
        } else {
            alert('Media type not supported: ' + clip.MediaType); 
        }

        // TODO: Fix comp duration (exess end time)
        // prev: layer.outPoint - layer.inPoint
        var clipDuration = clip.StreamLength / 1000;
        comp.duration += clipDuration;
    }

    comp.duration -= compBaseDuration;
    comp.openInViewer();
}

function drawPanel(rootPanel) {
    var panel = (rootPanel instanceof Panel)
        ? rootPanel
        : new Window('palette', 'Vegas EDL Import', undefined);

    // Composition settings
    var subpanelComp = panel.add('panel', undefined, 'Composition');  

    var grpComp = subpanelComp.add('group');
    grpComp.orientation = 'row';

    grpComp.add('statictext', undefined, 'Width:'); 
    var txtCompWidth = grpComp.add('edittext', undefined, '1920');
    txtCompWidth.characters = 4; 

    grpComp.add('statictext', undefined, 'Height:'); 
    var txtCompHeight = grpComp.add('edittext', undefined, '1080');
    txtCompHeight.characters = 4;

    grpComp.add('statictext', undefined, 'Frame Rate:'); 
    txtCompFrameRate = grpComp.add('edittext', undefined, '24');
    txtCompFrameRate.characters = 2;

    // Import options
    var grpOptions = panel.add('group');
    grpOptions.orientation = 'row';

    grpOptions.add('statictext', undefined, 'Solid Color:');
    var txtSolidColorHex = grpOptions.add('edittext', undefined, '#FFFFFF');
    txtSolidColorHex.characters = 6;

    var chkMarkKeyframes = grpOptions.add('checkbox', undefined, 'Mark Keyframes');
    var chkReverseLayerOrder = grpOptions.add('checkbox', undefined, 'Reverse Layer Order');

    panel.add('button', undefined, 'Import EDL...').onClick = function() {
        var options = {
            compWidth: parseInt(txtCompWidth.text),
            compHeight: parseInt(txtCompHeight.text),
            compFrameRate: parseInt(txtCompFrameRate.text),
            compPixelAspect: 1,
            solidColorHex: txtSolidColorHex.text,
            markKeyframes: chkMarkKeyframes.value,
            reverseLayerOrder: chkReverseLayerOrder.value
        }
        main(options);
        panel.close(); // If running undocked
    };
        
    return panel;
}

var panel = drawPanel(this);

if (panel instanceof Window) {
    // Running undocked
    panel.center();
    panel.show();
} else {
    // Running as a panel
    panel.layout.layout(true);
    panel.layout.resize();
}

// mirror audio gain (at `if (mediaType === 'audio')`)
// if in/out points are the same, merge both layers into one