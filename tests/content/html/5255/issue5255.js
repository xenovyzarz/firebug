function runTest()
{
    FBTest.sysout("issue5255.START");

    FBTest.openNewTab(basePath + "html/5255/issue5255.html", function(win)
    {
        FBTest.openFirebug();
        FBTest.selectPanel("html");

        FBTest.selectElementInHtmlPanel("mid", function(node)
        {
            // Start markup editing.
            FBTest.clickToolbarButton(null, "fbToggleHTMLEditing");

            var panelNode = FBTest.getPanel("html").panelNode;
            var textArea = panelNode.querySelector("textarea");

            FBTest.focus(textArea);

            // Select all (we want to override the existing markup)
            FBTest.sendShortcut("a", {accelKey: true});

            // Type new text
            FBTest.sendString("<i>3</i><i>4</i><i>5</i>", textArea);

            FBTest.waitForHtmlMutation(null, "div", function()
            {
                // Stop markup edit mode.
                FBTest.clickToolbarButton(null, "fbToggleHTMLEditing");

                // Verify page content
                var content = win.document.getElementById("content");
                FBTest.compare("1234567", content.textContent, "Page content must match.");

                // Verify object-status-path in the toolbar
                var panelStatus = FW.Firebug.chrome.window.document.getElementById("fbPanelStatus");
                var buttons = panelStatus.querySelectorAll("toolbarbutton");

                var length = buttons.length;
                if (FBTest.compare(5, length, "There must be 5 buttons: " + length))
                {
                    var labels = ["i", "section#content", "div", "body", "html"];
                    for (var i=0; i<buttons.length; i++)
                        FBTest.compare(labels[i], buttons[i].label, "Label must match");
                }

                FBTest.testDone("issue5255.DONE");
            });
        });
    });
}
