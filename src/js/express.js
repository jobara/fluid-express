// Express instance represented as a component
//
// Add additional routers and middleware as child components of this module
"use strict";
var fluid = fluid || require("infusion");
var gpii  = fluid.registerNamespace("gpii");
fluid.registerNamespace("gpii.express");

// Look up the path (parent, sibling, child) relationships for a node.
// Used in constructing the hierarchy we will use to wire together everything in our onCreate method.
//
// This does not require an invoker as it is basically a static method.
gpii.express.pathForComponent = function (that) {
    var instantiator  = fluid.getInstantiator(that);
    var path          = instantiator.idToPath(that.id);
    var segments      = fluid.model.parseEL(path);
    return segments;
};

// Make a note of the lineage of this middleware or router component, all the way back presumably to this gpii.express
// instance itself.
//
// This information will be used to wire together all nested routers and any middleware dependencies they have.
gpii.express.registerComponentLineage = function(childComponent, expressComponent) {
    // Get the list of parents for this component
    var segments = gpii.express.pathForComponent(childComponent);

    var childNickname  = segments[segments.length - 1];

    var expressSegments = gpii.express.pathForComponent(expressComponent);

    // If we only have one segment more than express, we are a child of express itself.
    // We need this to be able to handle cases in which express itself is a child component.
    if (segments.length === expressSegments.length + 1) {
        expressComponent.options.members.directChildrenOfInterest.push(childNickname);
    }
    // Otherwise, register the nickname of this component and its immediate parent path, each level will take care of the next highest.
    else if (segments.length > expressSegments.length + 1) {
        var parentPath = segments.slice(expressSegments.length, segments.length - 1).join(".");
        if (expressComponent.options.members.childrenByParent[parentPath]) {
            expressComponent.options.members.childrenByParent[parentPath].push(childNickname);
        }
        else {
            expressComponent.options.members.childrenByParent[parentPath] = [childNickname];
        }
    }
};

// Wire a child to its immediate descendants.
gpii.express.connectDirectDescendants = function(that, childComponent, childPath) {
    var descendants =  that.options.members.childrenByParent[childPath];

    // This component has descendants, wire them in first
    if (descendants !== undefined) {
        // Wire together one level of routers and middleware, then recurse
        for (var a = 0; a < descendants.length; a++) {
            var grandchildNickname  = descendants[a];
            var grandchildComponent = childComponent[grandchildNickname];
            if (fluid.hasGrade(grandchildComponent.options, "gpii.express.router")) {
                // We have to wire our children in with our path to preserve relative pathing, so that their router will begin with our path.
                childComponent.options.router.use(childComponent.options.path, grandchildComponent.options.router);

                // Recurse from here on down.
                that.connectDirectDescendants(grandchildComponent, childPath + "." + grandchildNickname);
            }
            else if (fluid.hasGrade(grandchildComponent.options, "gpii.express.middleware")) {
                if (childComponent.options.router) {
                    // We have to wire our children in with our path to preserve relative pathing, so that their router will begin with our path.
                    childComponent.options.router.use(childComponent.options.path, grandchildComponent.getMiddleware());
                }
                else {
                    fluid.fail(new Error({message: "A component must expose a router in order to work with child middleware components."}));
                }
            }
        }
    }

    // After our child components are in place, wire the router to itself.
    //
    // This must be done here because we want to give children the chance to own part of the path before we take the rest over.
    //
    // The path and method have to be used here so that parameters will be parsed correctly.
    if (fluid.hasGrade(childComponent.options, "gpii.express.router")) {
        childComponent.options.router[childComponent.options.method](childComponent.options.path, childComponent.getRouter());
    }
};

gpii.express.init = function(that) {
    if (!that.options.config || !that.options.config.express) {
        console.error("Cannot initialize express because you have not supplied a 'config' option.");
        return;
    }

    var express  = require("express");
    that.express = express();

    // Wire together all routers and components, beginning with ourselves
    for (var a = 0; a < that.options.members.directChildrenOfInterest.length; a++) {
        var directChildNickname = that.options.members.directChildrenOfInterest[a];
        var childComponent      = that[directChildNickname];
        if (fluid.hasGrade(childComponent.options, "gpii.express.router")) {
            // The router has to wire its own paths to preserve methods and path variables.
            // We just "use" it at the root level, and let it do the rest.
            that.express.use("/", childComponent.options.router);
        }
        else if (fluid.hasGrade(childComponent.options, "gpii.express.middleware")) {
            that.express.use(childComponent.getMiddleware());
        }

        // Recurse from here on down.
        that.connectDirectDescendants(childComponent, directChildNickname);
    }

    that.express.set("port", that.options.config.express.port);
    that.server = that.express.listen(that.options.config.express.port, function(){
        fluid.log("Express server listening on port " + that.express.get("port"));

        fluid.log("Express started...");
        that.events.started.fire(that.express);
    });
};

gpii.express.stopServer = function(that) {
    that.server.close(function(){
        fluid.log("Express stopped...");
        that.events.stopped.fire();
    });
};

fluid.defaults("gpii.express", {
    gradeNames: ["fluid.standardRelayComponent", "autoInit"],
    members: {
        directChildrenOfInterest: [],
        childrenByParent:         {}
    },
    path: "/",
    express: null,
    distributeOptions:[
        {
            record: {
                "funcName": "gpii.express.registerComponentLineage",
                "args": ["{arguments}.0", "{gpii.express}"]
            },
            target: "{that gpii.express.router}.options.listeners.routerLoaded"
        },
        {
            record: {
                "funcName": "gpii.express.registerComponentLineage",
                "args": ["{arguments}.0", "{gpii.express}"]
            },
            target: "{that gpii.express.middleware}.options.listeners.onCreate"
        }
    ],
    invokers: {
        "connectDirectDescendants" : {
            "funcName": "gpii.express.connectDirectDescendants",
            "args":     ["{that}", "{arguments}.0", "{arguments}.1"]
        }
    },
    events: {
        started:  null,
        stopped:  null
    },
    listeners: {
        onCreate: [
            {
                "funcName": "gpii.express.init",
                "args": "{that}"
            }
        ],
        onDestroy: [
            {
                funcName: "gpii.express.stopServer",
                args: ["{that}"]
            }
        ]
    }
});

