/* See license.txt for terms of usage */

define([
    "firebug/lib/object",
    "firebug/firebug",
    "firebug/chrome/firefox",
    "firebug/lib/events",
    "firebug/chrome/window",
    "firebug/lib/search",
    "firebug/lib/xml",
    "firebug/lib/options",
    "firebug/console/profiler",
    "firebug/chrome/searchBox",
    "firebug/console/consolePanel",
    "firebug/console/commandEditor",
    "firebug/console/functionMonitor",
    "firebug/console/eventMonitor",
    "firebug/console/performanceTiming",
],
function(Obj, Firebug, Firefox, Events, Win, Search, Xml, Options) {

// ********************************************************************************************* //
// Constants

const Cc = Components.classes;
const Ci = Components.interfaces;

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

var maxQueueRequests = 500;

// Note: createDefaultReturnValueInstance() is a local helper (see below).
var defaultReturnValue = createDefaultReturnValueInstance();

// ********************************************************************************************* //

Firebug.ConsoleBase =
{
    log: function(object, context, className, rep, noThrottle, sourceLink)
    {
        Events.dispatch(this.fbListeners,"log",[context, object, className, sourceLink]);
        return this.logRow(appendObject, object, context, className, rep, sourceLink, noThrottle);
    },

    logFormatted: function(objects, context, className, noThrottle, sourceLink)
    {
        Events.dispatch(this.fbListeners,"logFormatted",[context, objects, className, sourceLink]);
        return this.logRow(appendFormatted, objects, context, className, null, sourceLink,
            noThrottle);
    },

    openGroup: function(objects, context, className, rep, noThrottle, sourceLink, noPush)
    {
        return this.logRow(appendOpenGroup, objects, context, className, rep, sourceLink,
            noThrottle);
    },

    openCollapsedGroup: function(objects, context, className, rep, noThrottle, sourceLink, noPush)
    {
        return this.logRow(appendCollapsedGroup, objects, context, className, rep, sourceLink,
            noThrottle);
    },

    closeGroup: function(context, noThrottle)
    {
        return this.logRow(appendCloseGroup, null, context, null, null, null, noThrottle, true);
    },

    logRow: function(appender, objects, context, className, rep, sourceLink, noThrottle, noRow)
    {
        if (!context)
            context = Firebug.currentContext;

        if (FBTrace.DBG_ERRORS && FBTrace.DBG_CONSOLE && !context)
            FBTrace.sysout("Console.logRow has no context, skipping objects", objects);

        if (!context)
            return;

        if (noThrottle || !context)
        {
            var panel = this.getPanel(context);
            if (panel)
            {
                var row = panel.append(appender, objects, className, rep, sourceLink, noRow);
                var container = panel.panelNode;
                var template = Firebug.NetMonitor.NetLimit;

                while (container.childNodes.length > maxQueueRequests + 1)
                {
                    container.removeChild(container.firstChild.nextSibling);
                    panel.limit.limitInfo.totalCount++;
                    template.updateCounter(panel.limit);
                }
                Events.dispatch(this.fbListeners, "onLogRowCreated", [panel, row]);
                return row;
            }
        }
        else
        {
            if (!context.throttle)
            {
                FBTrace.sysout("console.logRow has not context.throttle! ");
                return;
            }
            var args = [appender, objects, context, className, rep, sourceLink, true, noRow];
            context.throttle(this.logRow, this, args);
        }
    },

    appendFormatted: function(args, row, context)
    {
        if (!context)
            context = Firebug.currentContext;

        var panel = this.getPanel(context);
        panel.appendFormatted(args, row);
    },

    clear: function(context)
    {
        if (!context)
            context = Firebug.currentContext;

        if (context)
        {
            // There could be some logs waiting in the throttle queue, so
            // clear asynchronously after the queue is flushed.
            context.throttle(this.clearPanel, this, [context]);

            // Also clear now
            this.clearPanel(context);

            // Let listeners react to console clearing
            Events.dispatch(this.fbListeners, "onConsoleCleared", [context]);
        }
    },

    clearPanel: function(context)
    {
        Firebug.Errors.clear(context);

        var panel = this.getPanel(context, true);
        if (panel)
            panel.clear();
    },

    // Override to direct output to your panel
    getPanel: function(context, noCreate)
    {
        if (context)
            return context.getPanel("console", noCreate);
    },
};

// ********************************************************************************************* //

var ActivableConsole = Obj.extend(Firebug.ActivableModule, Firebug.ConsoleBase);

Firebug.Console = Obj.extend(ActivableConsole,
{
    dispatchName: "console",
    toolName: "console",

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends Module

    showPanel: function(browser, panel)
    {
    },

    getExposedConsole: function(win)
    {
        return this.injector.getExposedConsole(win);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends Module

    initialize: function()
    {
        // Initialize log limit.
        this.updateMaxLimit();

        Firebug.ActivableModule.initialize.apply(this, arguments);

        Firebug.connection.addListener(this);

        this.syncFilterButtons(Firebug.chrome);
    },

    shutdown: function()
    {
        Firebug.connection.removeListener(this);
        Firebug.ActivableModule.shutdown.apply(this, arguments);
    },

    initContext: function(context, persistedState)
    {
        Firebug.ActivableModule.initContext.apply(this, arguments);
    },

    togglePersist: function(context)
    {
        var panel = context.getPanel("console");
        panel.persistContent = panel.persistContent ? false : true;

        Firebug.chrome.setGlobalAttribute("cmd_firebug_togglePersistConsole", "checked",
            panel.persistContent);
    },

    showContext: function(browser, context)
    {
        Firebug.chrome.setGlobalAttribute("cmd_firebug_clearConsole", "disabled", !context);

        Firebug.ActivableModule.showContext.apply(this, arguments);
    },

    watchWindow: function(context, win)
    {
        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("console.watchWindow; " + Win.safeGetWindowLocation(win));

        Firebug.Console.injector.attachConsoleInjector(context, win);
    },

    updateOption: function(name, value)
    {
        if (name == "console.logLimit")
            this.updateMaxLimit();
    },

    updateMaxLimit: function()
    {
        var value = Options.get("console.logLimit");
        maxQueueRequests =  value ? value : maxQueueRequests;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extend ActivableModule

    onObserverChange: function(observer)
    {
        if (this.isAlwaysEnabled())
        {
            // we inject the console during JS compiles so we need jsd
            Firebug.Debugger.addObserver(this);
        }
        else
        {
            Firebug.Debugger.removeObserver(this);
        }

        if (!Firebug.getSuspended())  // then Firebug is in action
            this.onResumeFirebug();   // and we need to test to see if we need to addObserver
        else
            this.onSuspendFirebug();
    },

    onSuspendFirebug: function()
    {
        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("console.onSuspendFirebug isAlwaysEnabled:" +
                Firebug.Console.isAlwaysEnabled());

        if (Firebug.Errors.toggleWatchForErrors(false))
        {
            this.setStatus();
            // Make sure possible errors coming from the page and displayed in the Firefox
            // status bar are removed.
            this.clear();
        }
    },

    onResumeFirebug: function()
    {
        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("console.onResumeFirebug\n");

        var watchForErrors = Firebug.Console.isAlwaysEnabled() || Firebug.Console.hasObservers();
        if (Firebug.Errors.toggleWatchForErrors(watchForErrors))
            this.setStatus();
    },

    onToggleFilter: function(context, filterType)
    {
        if (!context)
            context = Firebug.currentContext;

        Options.set("consoleFilterTypes", filterType);

        var panel = this.getPanel(context, true);
        if (panel)
        {
            panel.setFilter(Options.get("consoleFilterTypes"));
            Firebug.Search.update(context);
        }
    },

    syncFilterButtons: function(chrome)
    {
        if (Options.get("consoleFilterTypes") == "")
        {
            var button = chrome.$("fbConsoleFilter-all");
            button.checked = true;
        }
        else
        {
            var filterTypes = Options.get("consoleFilterTypes").split(" ");
            for (var type = 0; type < filterTypes.length; type++)
            {
                var button = chrome.$("fbConsoleFilter-" + filterTypes[type]);
                button.checked = true;
            }
        }
    },

    setStatus: function()
    {
        var fbStatus = Firefox.getElementById("firebugStatus");
        if (fbStatus)
        {
            if (Firebug.Errors.watchForErrors)
                fbStatus.setAttribute("console", "on");
            else
                fbStatus.removeAttribute("console");
        }
        else
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("console.setStatus ERROR no firebugStatus element");
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // BTI

    /**
     * A previously enabled tool becomes active and sends us an event.
     */
    onActivateTool: function(toolname, active)
    {
        if (FBTrace.DBG_ACTIVATION)
            FBTrace.sysout("Console.onActivateTool "+toolname+" = "+active);

        // Console depends on script to get injected (for now)
        if (toolname === "script")
        {
            if (this.isAlwaysEnabled())
            {
                //this.asTool.setActive(active);  // then track the activation of the debugger;
            }
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    logRow: function(appender, objects, context, className, rep, sourceLink, noThrottle, noRow)
    {
        if (!context)
            context = Firebug.currentContext;

        if (FBTrace.DBG_WINDOWS && !context)
            FBTrace.sysout("Console.logRow: no context \n");

        if (this.isAlwaysEnabled())
            return Firebug.ConsoleBase.logRow.apply(this, arguments);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    /**
     * Returns the value that the console must ignore.
     *
     * @return {*} The default value
     */
    getDefaultReturnValue: function()
    {
        return defaultReturnValue;
    },

    /**
     * Returns true if the passed object has to be ignored by the console.
     *
     * @param {*} o The object to test
     *
     * @return {boolean} The result of the test
     */
    isDefaultReturnValue: function(obj)
    {
        return obj === defaultReturnValue;
    }
});

// ********************************************************************************************* //

Firebug.ConsoleListener =
{
    log: function(context, object, className, sourceLink)
    {
    },

    logFormatted: function(context, objects, className, sourceLink)
    {
    }
};

// ********************************************************************************************* //

var appendObject = Firebug.ConsolePanel.prototype.appendObject;
var appendFormatted = Firebug.ConsolePanel.prototype.appendFormatted;
var appendOpenGroup = Firebug.ConsolePanel.prototype.appendOpenGroup;
var appendCollapsedGroup = Firebug.ConsolePanel.prototype.appendCollapsedGroup;
var appendCloseGroup = Firebug.ConsolePanel.prototype.appendCloseGroup;

// ********************************************************************************************* //
// Local Helpers

function createDefaultReturnValueInstance()
{
    var proto = {
        __exposedProps__: {
            "toString": "rw"
        },
        toString: function()
        {
            return undefined;
        }
    };

    return Object.preventExtensions(Object.create(proto));
}

// ********************************************************************************************* //
// Registration

Firebug.registerActivableModule(Firebug.Console);

return Firebug.Console;

// ********************************************************************************************* //
});
