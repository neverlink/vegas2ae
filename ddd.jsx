function main(compWidth, compHeight, compFrameRate, reverseLayerOrder) {
    var edlFile;
    edlFile = File.openDialog('Select an EDL file');
    if (!edlFile) {
        alert('No file selected!');
        return;
    }
    
    function parseEDL(edlFile) {
        edlFile.open("r");
        var lines = edlFile.read().split("\n");
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
    
    var compName = edlFile.name.split('.txt')[0]; 
    var edl = parseEDL(edlFile);

    if (reverseLayerOrder)
        edl.reverse();

    var compBaseDuration = 1; // Subtracted later // Default for now, must be calculated
    var comp = app.project.items.addComp(
        name=compName,
        width=compWidth,
        height=compHeight,
        pixelAspect=1,
        duration=compBaseDuration,
        frameRate=compFrameRate
    );
    
    var failedImports = {};
    var ignoreFailedImports = false;
    function importFootage(edlClip) {
        var clipFile = File(edlClip.FileName);
        var footageItem;

        // Check if same file is already imported
        // TODO: Why loop from 1?
        for (var j = 1; j <= app.project.numItems; j++) {
            var projectItem = app.project.items[j];

            if (!clipFile) {
                failedImports[edlClip.FileName] = true;
                continue;
            } else if (!(projectItem instanceof FootageItem) || projectItem.mainSource instanceof PlaceholderSource) {
                continue;
            }
            
            if (projectItem.file.fullName === clipFile.fullName) {
                footageItem = projectItem;
                break;
            }
        }

        if (footageItem)
            return app.project.importFile(new ImportOptions(clipFile));

        if (!ignoreFailedImports)
            ignoreFailedImports = Window.confirm(
                'Failed to import file:\n' + edlClip.FileName +
                '\nA placeholder will be used instead.' +
                '\n\nDo you want to disable this warning?'
            );
        
        return app.project.importPlaceholder(
            edlClip.FileName,
            compWidth,
            compHeight,
            compFrameRate,
            edlClip.StreamLength / 1000
        )
    }
    
    for (var clipIndex = 0; clipIndex < edl.length; clipIndex++) {
        var clip = edl[clipIndex];
        if (failedImports[clip.FileName])
            continue;
        var footageItem = importFootage(clip);
        var layer = comp.layers.add(footageItem);
    
        // Timeline position
        layer.startTime = clip.StartTime / 1000;
        layer.endTime = (clip.StartTime + clip.StreamLength) / 1000;
    
        // Trim points
        layer.inPoint = clip.StreamStart / 1000;
        layer.outPoint = (clip.StartTime + clip.StreamLength) / 1000;
    
        layer.stretch = clip.PlayRate * 100;
    
        function applyFades(handle) {
            var minValue = 0;
            var maxValue = 100;
    
            if (clip.FadeTimeIn > 0) {
                handle.setValueAtTime(layer.inPoint, minValue); 
                handle.setValueAtTime(layer.inPoint + (clip.FadeTimeIn / 1000), maxValue);
            }
            if (clip.FadeTimeOut > 0) {
                handle.setValueAtTime(layer.outPoint - (clip.FadeTimeOut / 1000), maxValue);
                handle.setValueAtTime(layer.outPoint, minValue);
            }
        }
    
        var mediaType = clip.MediaType.toLowerCase();
        if (mediaType === 'audio') { 
            layer.enabled = false; // Disables video
            var mixer = layer.Effects.addProperty('Stereo Mixer');
            applyFades(mixer['Left Level']); 
            applyFades(mixer['Right Level']);
        } else if (mediaType === 'video') {
            layer.audioEnabled = false; // Disables audio
            applyFades(layer['opacity']);
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
    var title = 'Vegas EDL Import';
    var panel = (rootPanel instanceof Panel)
        ? rootPanel
        : new Window('palette', title, undefined);

    panel.text = title;
    
    // Composition settings
    subpanelComp = panel.add("panel", undefined, "Composition");

    var grpComp = subpanelComp.add('group');
    grpComp.orientation = 'row';
    
    grpComp.add('statictext', undefined, 'Width:'); 
    txtCompWidth = grpComp.add('edittext', undefined, '1920');
    txtCompWidth.characters = 4; 
    
    grpComp.add('statictext', undefined, 'Height:'); 
    txtCompHeight = grpComp.add('edittext', undefined, '1080');
    txtCompHeight.characters = 4; 
    
    grpComp.add('statictext', undefined, 'Frame Rate:'); 
    txtCompFrameRate = grpComp.add('edittext', undefined, '24');
    txtCompFrameRate.characters = 2;

    // Import options
    var grpOptions = panel.add('group');
    grpOptions.orientation = 'row';
    var chkReverseLayerOrder = grpOptions.add('checkbox', undefined, 'Reverse Layer Order?');
    
    panel.add('button', undefined, 'Import EDL...').onClick = function() { 
        var compWidth = parseInt(txtCompWidth.text);
        var compHeight = parseInt(txtCompHeight.text);
        var compFrameRate = parseInt(txtCompFrameRate.text);
        main(compWidth, compHeight, compFrameRate, chkReverseLayerOrder.value);
        panel.close(); // If running undocked
    };
    
    return panel;
}

var panel = drawPanel(this);

// Necessary? Also, this can be moved outside
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

// rename/recolor repeating datasources where one is audio, other is video
// rainbow color layers like in fl?
// applyPreset to every clip?