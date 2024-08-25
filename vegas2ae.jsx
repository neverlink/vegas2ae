function getKeyframeEase(curveType) {
    var easeIn;
    var easeOut;

    if (curveType == 1) { 
        // Linear
        return null;
    } else if (curveType == -2) {
        // Slow in, fast out
        easeIn = new KeyframeEase(0, 75);
        easeOut = new KeyframeEase(0, 0.1);
    } else if (curveType == 2) {
        // Fast in, slow out
        easeIn = new KeyframeEase(0, 0.1);
        easeOut = new KeyframeEase(0, 75);
    } else if (curveType == 4) {
        // Easy Ease
        easeIn = new KeyframeEase(0, 33.33);
        easeOut = easeIn;
    } else if (curveType == -4) {
        // Inverted Easy Ease
        easeIn = new KeyframeEase(100, 5);
        easeOut = easeIn;
    } else {
        alert('Unregistered CurveType: ' + curveType);
    }

    return easeIn && easeOut ? [easeIn, easeOut] : null;
}

function applyFades(clip, layer, propHandle, markKeyframes) {
    var minValue = 0;
    var maxValue = propHandle.value;

    if (clip.FadeTimeIn > 0) {
        var fadeStart = layer.inPoint;
        var fadeEnd = fadeStart + (clip.FadeTimeIn);
        propHandle.setValueAtTime(fadeStart, minValue);
        propHandle.setValueAtTime(fadeEnd, maxValue);
        
        var easeArgs = getKeyframeEase(clip.CurveIn);
        if (easeArgs) {
            propHandle.setTemporalEaseAtKey(1, [easeArgs[0]]);
            propHandle.setTemporalEaseAtKey(2, [easeArgs[1]]);
        }

        if (markKeyframes) { 
            var marker = new MarkerValue('Fade In'); 
            marker.duration = fadeEnd - fadeStart;
            layer.marker.setValueAtTime(fadeStart, marker);
        }
    }

    if (clip.FadeTimeOut > 0) {
        var fadeStart = layer.outPoint - (clip.FadeTimeOut);
        var fadeEnd = layer.outPoint;
        
        propHandle.setValueAtTime(fadeStart, maxValue);
        propHandle.setValueAtTime(fadeEnd, minValue);

        var easeArgs = getKeyframeEase(clip.CurveOut);
        if (easeArgs) {
            propHandle.setTemporalEaseAtKey(propHandle.numKeys - 1, [easeArgs[0]]);
            propHandle.setTemporalEaseAtKey(propHandle.numKeys, [easeArgs[1]]);
        };

        if (markKeyframes) {
            var marker = new MarkerValue('Fade In');
            marker.duration = fadeEnd - fadeStart;
            layer.marker.setValueAtTime(fadeStart, marker);
        }
    }
}

function getPlaceholder(edlClip, options) {
    return app.project.importPlaceholder(
        edlClip.FileName,
        options.compWidth,
        options.compHeight,
        options.compFrameRate,
        edlClip.Length
    )
}

function getSolid(edlClip, options) {
    edlClip.FileName = 'Solid';
    var footageItem = getPlaceholder(edlClip, options);
    return footageItem.replaceWithSolid(
        options.solidColorRGB,
        'Solid',
        options.compWidth,
        options.compHeight,
        options.compPixelAspect
    );
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

function importFootage(edlClip, options) {
    var clipFile = File(edlClip.FileName);
    var footageItem = findFootageItem(edlClip, clipFile);

    if (footageItem)
        return footageItem;
    if (!edlClip.FileName)
        return getSolid(edlClip, options);
    if (clipFile.exists)
        return app.project.importFile(new ImportOptions(clipFile));
    if (!options.ignoreFailedImports) {
        options.ignoreFailedImports = Window.confirm(
            'Failed to import file:\n' + edlClip.FileName +
            '\nA placeholder will be used instead.' +
            '\n\nPress OK to suppress this warning.'
        );
    }
    return getPlaceholder(edlClip, options);
}

function parseEDL(edlFile) {
    edlFile.open('r');
    var lines = edlFile.read().split('\n');
    edlFile.close();

    // Remove last row (expected to be blank)
    if (!lines[lines.length - 1])
        lines.pop();

    var colNames = lines.shift().replace(/"/g, '').split(';');

    const fieldConversions = {
        Length: function(value) { return parseFloat(value) / 1000 },
        StartTime: function(value) { return parseFloat(value) / 1000 },
        StreamStart: function(value) { return parseFloat(value) / 1000 },
        PlayRate: function(value) { return parseFloat(value) },
        SustainGain: function(value) { return parseFloat(value) },
        FadeTimeIn: function(value) { return parseFloat(value) / 1000 },
        FadeTimeOut: function(value) { return parseFloat(value) / 1000 },
    };

    var edl = []; // Array of clips (aka "reels")
    for (var rowIndex = 0; rowIndex < lines.length; rowIndex++) { 
        var cols = lines[rowIndex].replace(/"/g, '').split('; ');
        var row = {};
        for (var colIndex = 0; colIndex < cols.length; colIndex++) { 
            var fieldName = colNames[colIndex];
            var value = cols[colIndex];
            if (fieldConversions[fieldName]) {
                value = fieldConversions[fieldName](value);
            }
            row[fieldName] = value;
        }
        edl.push(row);
    }

    return edl;
}

function importEDL(options) {
    var edlFile;
    edlFile = File.openDialog('Select an EDL file');
    if (!edlFile) {
        alert('No file selected!');
        return;
    }

    var edl = parseEDL(edlFile);
     if (options.reverseLayerOrder)
        edl.reverse();

    var compBaseDuration = 1; // Subtracted later
    var comp = app.project.items.addComp(   
        edlFile.name.split('.txt')[0],
        options.compWidth,
        options.compHeight,
        options.compPixelAspect,
        compBaseDuration,
        options.compFrameRate
    );
    comp.bgColor = options.compBgColorRGB;

    var failedImports = {};

    for (var clipIndex = 0; clipIndex < edl.length; clipIndex++) {
        var clip = edl[clipIndex];
        if (failedImports[clip.FileName])
            continue;
        var footageItem = importFootage(clip, options);
        var layer = comp.layers.add(footageItem);

        // Stretch layer first (if necessary)
        layer.stretch = 100 / clip.PlayRate;

        // Trim points (snapped to the closest frame)
        layer.inPoint = Math.round((clip.StreamStart) / comp.frameDuration) * comp.frameDuration;
        layer.outPoint = Math.round((clip.StreamStart + clip.Length) / comp.frameDuration) * comp.frameDuration; 

        // Timeline position
        layer.startTime = (clip.StartTime) - layer.inPoint;
    
        // Layer color
        layer.label = (clipIndex + 1) % 16; 

        var mediaType = clip.MediaType.toLowerCase();
        var markKeyframes = options.markKeyframes;
        if (mediaType === 'audio') { 
            layer.enabled = false; // Disables video
            var mixer = layer.Effects.addProperty('Stereo Mixer');
            mixer['Left Level'].setValue(100 * clip.SustainGain);
            mixer['Right Level'].setValue(100 * clip.SustainGain);
            applyFades(clip, layer, mixer['Left Level'], markKeyframes);
            applyFades(clip, layer, mixer['Right Level'], markKeyframes);
        } else if (mediaType === 'video') {
            layer.audioEnabled = false; // Disables audio
            applyFades(clip, layer, layer['opacity'], markKeyframes);
        } else {
            alert('Media type not supported: ' + clip.MediaType); 
        }

        comp.duration += layer.outPoint - layer.inPoint;
    }

    comp.duration -= compBaseDuration;
    comp.openInViewer();
}

function hexToFloats(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length !== 3 && hex.length !== 6) {
        alert(
            'Hex color #' + hex + ' is invalid!' + '\n\n' +
            'Defaulting to black for solids.'
        );
        return [0, 0, 0];
    }
    if (hex.length === 3) // Expand shorthand (e.g., #abc -> #aabbcc)
      hex = hex.split('').map(function(c) {return c + c}).join('');
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    return [r, g, b];
}

function drawPanel(rootPanel) {
    var panel = (rootPanel instanceof Panel)
        ? rootPanel
        : new Window('palette', 'Vegas EDL Import', undefined);

    // Section 1
    var compSection1 = panel.add('panel', undefined, 'Composition');  
    compSection1.alignment = ['fill', 'center'];

    // Composition settings
    var grpCompRow1 = compSection1.add('group');
    grpCompRow1.orientation = 'row';

    grpCompRow1.add('statictext', undefined, 'Width:'); 
    var txtCompWidth = grpCompRow1.add('edittext', undefined, '1920');
    txtCompWidth.characters = 4; 

    grpCompRow1.add('statictext', undefined, 'Height:'); 
    var txtCompHeight = grpCompRow1.add('edittext', undefined, '1080');
    txtCompHeight.characters = 4;

    grpCompRow1.add('statictext', undefined, 'Frame Rate:'); 
    txtCompFrameRate = grpCompRow1.add('edittext', undefined, '24');
    txtCompFrameRate.characters = 2;

    // Section 2
    var compSection2 = panel.add('panel', undefined, 'Colour');  
    compSection2.alignment = ['fill', 'center'];

    // Color options
    var grpCompRow2 = compSection2.add('group');
    grpCompRow2.orientation = 'row';

    grpCompRow2.add('statictext', undefined, 'Background:');
    var txtBgColorHex = grpCompRow2.add('edittext', undefined, '#000000');
    txtBgColorHex.characters = 6;

    grpCompRow2.add('statictext', undefined, 'Solids:');
    var txtSolidColorHex = grpCompRow2.add('edittext', undefined, '#000000');
    txtSolidColorHex.characters = 6;

    // Import options
    var grpOptions = panel.add('group');
    grpOptions.orientation = 'row';

    var chkMarkKeyframes = grpOptions.add('checkbox', undefined, 'Mark Keyframes');
    var chkReverseLayerOrder = grpOptions.add('checkbox', undefined, 'Reverse Layer Order');
    
    function runImport() {
        var options = {
            compWidth: parseInt(txtCompWidth.text),
            compHeight: parseInt(txtCompHeight.text),
            compFrameRate: parseInt(txtCompFrameRate.text),
            compPixelAspect: 1,
            compBgColorRGB: hexToFloats(txtBgColorHex.text),
            solidColorRGB: hexToFloats(txtBgColorHex.text),
            markKeyframes: chkMarkKeyframes.value,
            reverseLayerOrder: chkReverseLayerOrder.value,
            ignoreFailedImports: false
        }
        importEDL(options);
        panel.close(); // If running undocked
    }

    btnRunImport = panel.add('button', undefined, 'Import EDL...');
    btnRunImport.alignment = ['center', 'center'];
    btnRunImport.onClick = runImport;
    // runImport(); // Debug only

    return panel;
}

var panel = drawPanel(this);

panel.onResizing = panel.onResize = function() {
    this.layout.resize();
};

if (panel instanceof Window) {
    // Running undocked
    panel.center();
    panel.show();
} else {
    // Running as a panel
    panel.layout.layout(true);
    panel.layout.resize();
}

// if in/out points are the same, merge both layers into one
// fix comp duration