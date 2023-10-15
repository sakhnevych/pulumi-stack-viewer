// Global state of the application
let config = null;
let currentState = {
    project: null,
    env: null,
    state: null,
    lastState: null,
    // view: info | stack | preview | state
    view: 'info',
}

// Initialize the application
$(function() {
    configuration.readConfig((success) => {
        if (success) {
            controller.initMenu();
        }
    });
});


// Controls the application, state, and view
const controller = {
    initMenu: function () {
        currentState.project = config.defaultProjectKey;
        currentState.env = config.defaultEnvironmentKey;

        view.init(config, controller.onEnvironmentSelect);
        controller.updateProjectView();
    },

    onProjectSelect: function (projectKey) {
        if (currentState.project === projectKey) {
            return;
        }
        currentState.project = projectKey;
        controller.updateProjectView();
    },

    onEnvironmentSelect: function (envKey) {
        if (currentState.env === envKey) {
            return;
        }
        currentState.env = envKey;
        controller.updateEnvironmentView();
    },

    onStateSelect: function (stateKey) {
        if (currentState.state === stateKey) {
            return;
        }
        currentState.state = stateKey;
        controller.updateStateView();
    },

    onViewSelect: function (viewKey) {
        if (currentState.view === viewKey) {
            return;
        }
        currentState.view = viewKey;
        controller.updateContentView();
    },

    updateProjectView: function () {
        let projectName = config.projects[currentState.project];
        view.project.setSelectedProject(projectName);

        // reset the internal environment state
        view.env.cleanLastUpdateAt();
        // update last updated dates for all environments
        for (let env of Object.keys(config.environments)) {
            $.ajax({
                url: `state/${currentState.project}/${env}/latest.txt`,
                dataType: 'text',
                success: function (data) {
                    // 'data' is the latest state date
                    data = data.trim()
                    view.env.setLastUpdateAt(env, data);
                },
                error: function () {
                    // expected error when there are no deployments
                    view.env.setLastUpdateAt(env, null);
                }
            });
        }

        controller.updateEnvironmentView();
    },

    updateEnvironmentView: function () {
        // reset the internal environment state
        view.state.clean();
        currentState.state = null;
        currentState.lastState = null;

        // get the latest state and update the view
        $.ajax({
            url: `state/${currentState.project}/${currentState.env}/latest.txt`,
            dataType: 'text',
            success: function(data) {
                // 'data' is the latest state date

                // save the state in the format "2023-06-30_15-23"
                data = data.trim()
                currentState.state = data;
                currentState.lastState = data;

                view.state.enable(data);
                view.view.enable();

                controller.updateStateView();
            },
            error: function() {
                // expected error when there are no deployments
                view.state.disable();
                view.view.disable();
                view.content.showTipContent("This environment doesn't have deployments. Select another one to browse the state.");
            }
        });

        // update the state picker
        let stackHistoryUrl = `state/${currentState.project}/${currentState.env}/history.txt`;
        $.ajax({
            url: stackHistoryUrl,
            dataType: 'text',
            success: function(data) {
                let lines = data.trim().split('\n');
                lines = utils.uniqueEntries(lines);
                lines.reverse();

                view.state.refreshStatePicker(lines);
            },
            error: function() {
                // expected error when there are no deployments
                view.state.disable();
                view.view.disable();
                view.content.showTipContent("This environment doesn't have deployments. Select another one to browse the state.");
            }
        });
    },

    updateStateView: function () {
        view.state.setSelectedState(currentState.state, currentState.state === currentState.lastState);

        controller.updateContentView();
    },

    updateContentView: function () {
        view.content.clean();

        let project = currentState.project;
        let env = currentState.env;
        let state = currentState.state;

        let baseUrl = `state/${project}/${env}/${state}/`;
        if (currentState.view === 'info') {
            controller.loadInfoContent(project, env, state);
        } else if (currentState.view === 'stack') {
            controller.loadFileIframeContent(baseUrl + 'stack.txt');
        } else if (currentState.view === 'preview') {
            controller.loadFileIframeContent(baseUrl + 'preview.txt');
        } else if (currentState.view === 'state') {
            controller.loadFileIframeContent(baseUrl + 'stack.json');
        } else {
            controller.fatalError(
                `Unknown view: ${currentState.view}. Please contact your administrator to fix it.`,
                null, true, null
            );
        }
    },

    loadInfoContent: function (project, env, state) {
        let stackUrl = `state/${project}/${env}/${state}/stack.json`;
        $.ajax({
            url: stackUrl,
            dataType: 'text',
            success: function(data) {
                let stack = JSON.parse(data);
                view.content.showInfoContent({
                    project: config.projects[project],
                    env: config.environments[env],
                    state: state,
                    createdAt: stack['deployment']['manifest']['time'],
                    pulumiProject: stack['deployment']['secrets_providers']['state']['project'],
                    pulumiStack: stack['deployment']['secrets_providers']['state']['stack'],
                    resourceCounter: utils.pulumi.countResources(stack),
                    outputs: utils.pulumi.getStackOutputs(stack)
                });
            },
            error: function(e) {
                controller.fatalError(
                    'The data structure for the selected state is wrong. Please contact your administrator to fix it.',
                    `Missing file: /${stackUrl}`,
                    false,
                    e.message
                );
            }
        });
    },

    loadFileIframeContent: function (url) {
        $.ajax({
            url: url,
            dataType: 'text',
            success: function (ignored) {
                // the data is not required, we validate that the file exists
                view.content.showIframeContent(url);
            },
            error: function (e) {
                controller.fatalError(
                    'The data structure for the selected state is wrong. Please contact your administrator to fix it.',
                    `Missing file: /${url}`,
                    false,
                    e.message
                );
            }
        });
    },

    // when the application cannot work properly
    fatalError: function (message, tip, disableAll, error = null) {
        if (disableAll) {
            view.state.disable();
            view.view.disable();
        }
        view.content.showErrorContent(message, tip, error);
    }
};

const configuration = {
    readConfig: function (onInitConfigHandler) {
        $.ajax({
            url: 'config.json',
            dataType: 'json',
            success: function (data) {
                let parsedConfig = JSON.parse(JSON.stringify(data));
                let success = configuration.initConfig(parsedConfig);
                onInitConfigHandler(success);
            },
            error: function (ex) {
                controller.fatalError(
                    'The configuration file is missing. Please contact your administrator to fix it.',
                    'Missing file: /config.json',
                    true,
                    ex.message
                );
            }
        });
    },

    initConfig: function (value) {
        try {
            config = value;
            // set default project
            config.defaultProjectKey = value.defaults?.project ?? Object.keys(value.projects)[0];
            config.defaultProjectName = value.projects[config.defaultProjectKey];

            // set default environment
            config.defaultEnvironmentKey = value.defaults?.environment ?? Object.keys(value.environments)[0];
            config.defaultEnvironmentName = value.environments[config.defaultEnvironmentKey];

            return true;
        } catch (ex) {
            controller.fatalError(
                'The configuration is wrong. Please contact your administrator to fix it.',
                'Configuration file: /config.json',
                true,
                ex.message
            );
            return false;
        }
    }
};

const view = {
    init: function (initConfig, onSelectEnvHandler) {
        view.project.init(initConfig.projects, initConfig.defaultProjectName);
        view.project.initProjectDropdown();

        view.env.init(initConfig.environments, onSelectEnvHandler);
        view.env.setActiveEnv(initConfig.defaultEnvironmentKey);

        view.state.init();

        view.view.init();
    },

    project: {
        init: function (projects, defaultProjectName) {
            let projectHtml = '';
            for (let [key, name] of Object.entries(projects)) {
                projectHtml += `<a href="#" rel="${key}">${name}</a>`;
            }
            $('.project-dropdown-options').html(projectHtml);
            $('#project-dropdown-btn').text(defaultProjectName);
        },
        initProjectDropdown: function () {
            let projectDiv = $('.project-dropdown');
            let dropdown = $('.project-dropdown-options');

            dropdown.find('a').each(function () {
                let selectedProject = $(this).attr("rel");
                $(this).on('click', function () {
                    controller.onProjectSelect(selectedProject);
                    selectProjectClose();
                });
            });

            // show/hide choose state dropdown
            $("#project-dropdown-btn").click(function () {
                dropdown.toggle();
            });

            // hide dropdown on click outside
            $(document).on('click', function (event) {
                if (!projectDiv.is(event.target) && projectDiv.has(event.target).length === 0) {
                    selectProjectClose();
                }
            });
            // hide dropdown on esc key
            $(document).on('keydown', function (event) {
                if (event.keyCode === 27) {
                    selectProjectClose();
                }
            });

            function selectProjectClose() {
                if (dropdown.is(":visible")) {
                    dropdown.hide();
                }
            }
        },

        setSelectedProject: function (projectName) {
            $("#project-dropdown-btn").text(projectName);
        }

    },

    env: {
        /* START Choose env menu  */
        init: function (environments, onSelectEnvHandler) {
            // init environments tab
            let envHtml = '';
            for (let [key, name] of Object.entries(environments)) {
                envHtml += `<li rel="${key}">
                    ${name}<br>
                    <span id="${key}-updated-at" class="updated-at">no updates</span>
                  </li>\n`;
            }
            $('.env-tab').html(envHtml);

            // add environment click event handler
            $(".env-tab li").on('click', function () {
                let activeEnv = $(this).attr("rel");
                $(".env-tab li").removeClass("active");
                $(this).addClass("active");
                onSelectEnvHandler(activeEnv);
            });
        },

        setActiveEnv: function (activeEnvKey) {
            let envTab = $('.env-tab');

            // Remove active class from all li tags
            envTab.find('li').removeClass('active');

            // Iterate through each li element to find the one with the given rel attribute
            envTab.find('li').each(function() {
                if ($(this).attr('rel') === activeEnvKey) {
                    // Add active class to the matched element
                    $(this).addClass('active');
                    return false;  // Break out of each loop
                }
            });
        },

        cleanLastUpdateAt: function () {
            for (let env of Object.keys(config.environments)) {
                $('#' + env + '-updated-at').text('..');
            }
        },

        setLastUpdateAt: function (envKey, date) {
            let value = date === null ? 'no updates' : utils.date.convertStateDateToHumanReadable(date);
            $('#' + envKey + '-updated-at').text(value);
        }

    },

    state: {
        currentPrefix: ' (current)',

        init: function () {
            let chooseStateDiv = $('.state-dropdown');
            let dropdown = $('.choose-state-dropdown');
            let filter = $('.choose-state-filter');

            // show/hide choose state dropdown
            $("#choose-state-btn").on('click', function () {
                dropdown.toggle();
            });
            // filter state history by the input
            filter.on('keyup', function () {
                view.state._chooseStateFilter();
            });

            // hide dropdown on click outside
            $(document).on('click', function (event) {
                if (!chooseStateDiv.is(event.target) && chooseStateDiv.has(event.target).length === 0) {
                    view.state._selectStateClose();
                }
            });
            // hide dropdown on esc key
            $(document).on('keydown', function (event) {
                if (event.keyCode === 27) {
                    view.state._selectStateClose();
                }
            });
        },

        enable: function (latestStateName) {
            // the 'latestStateName' is in the format "2023-06-30_15-23"
            let convertedDate = utils.date.convertStateDateToHumanReadable(latestStateName);
            let stateName = convertedDate + view.state.currentPrefix;

            $('#choose-state-btn')
                .prop('disabled', false)
                .text(stateName);
        },
        disable: function () {
            $('#choose-state-btn')
                .prop('disabled', true)
                .text('no state');
        },
        clean: function () {
            $('#choose-state-btn').text('..');
            $('.choose-state-dropdown a').remove();
        },
        refreshStatePicker: function (stateDateHistory) {
            // the "stateDateHistory" is a list of dates in the "2023-06-30_15-23" format

            let dropdown = $('.choose-state-dropdown');

            let first = true;
            let stateHtml = '';
            for (let entry of stateDateHistory) {
                let convertedDate = utils.date.convertStateDateToHumanReadable(entry);
                if (first) {
                    convertedDate += view.state.currentPrefix;
                    first = false;
                }
                stateHtml += `<a href="#" rel="${entry}">${convertedDate}</a>`;
            }
            dropdown.append(stateHtml);

            dropdown.find('a').each(function () {
                let selectedState = $(this).attr("rel");
                $(this).on('click', function () {
                    controller.onStateSelect(selectedState);
                    view.state._selectStateClose();
                });
            });
        },

        setSelectedState: function (stateKey, isLatest) {
            let selectedState = utils.date.convertStateDateToHumanReadable(stateKey);
            if (isLatest) {
                selectedState += view.state.currentPrefix;
            }
            $("#choose-state-btn").text(selectedState);
        },

        _selectStateClose: function () {
            let dropdown = $('.choose-state-dropdown');
            let filter = $('.choose-state-filter');
            if (dropdown.is(":visible")) {
                dropdown.hide();
                filter.val('');
                view.state._chooseStateFilter();
            }
        },

        _chooseStateFilter: function () {
            let dropdown = $('.choose-state-dropdown');
            let filter = $('.choose-state-filter');
            let filterInput = filter.val().toUpperCase();
            dropdown.find('a').each(function () {
                let txtValue = $(this).text();
                if (txtValue.toUpperCase().indexOf(filterInput) > -1) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        }
    },

    view: {
        init: function () {
            $(".view-tab li").on("click", view.view.onSelectHandler);
        },
        enable: function () {
            $(".view-tab li")
                .on("click", view.view.onSelectHandler)
                .removeClass('disabled')
        },
        disable: function () {
            $(".view-tab li")
                .off() // Removes all event handlers
                .addClass('disabled');
        },

        onSelectHandler: function () {
            $(".view-tab li").removeClass("active");
            $(this).addClass("active");

            let activeProject = $(this).attr("rel");
            controller.onViewSelect(activeProject);
        }
    },

    content: {
        showTipContent: function (tip) {
            $('#content-tip-text').text(tip);

            // switch the content view
            $('.content-tip').show();
            $('.content-error').hide();
            $('.content-iframe').hide();
            $('.content-info').hide();
        },

        showInfoContent: function (data) {
            // fill header
            $('#info-header-project').text(data.project);
            $('#info-header-env').text(data.env);
            $('#info-header-state').text(utils.date.convertStateDateToHumanReadable(data.state));

            // fill pulumi details
            $('#info-details-created-at').text(utils.date.convertIsoDateToHumanReadable(data.createdAt));
            $('#info-details-project').text(data.pulumiProject);
            $('#info-details-stack').text(data.pulumiStack);
            $('#info-details-resource-counter').text(data.resourceCounter);

            // fill outputs
            $('#info-outputs').html(formatOutputs(data.outputs));

            // switch the content view
            $('.content-tip').hide();
            $('.content-error').hide();
            $('.content-iframe').hide();
            $('.content-info').show()

            function formatOutputs(outputs) {
                let html = '';
                for (let [key, value] of Object.entries(outputs)) {
                    html += `<div class="row">
                        <div class="output-name">${key}:</div>
                        <div class="output-value">${value}</div>
                    </div>`;
                }
                return html;
            }
        },

        showIframeContent: function (url) {
            // set the correct URL for the iframe
            $('#iframe-file-content').attr('src', url);

            // switch the content view
            $('.content-tip').hide();
            $('.content-error').hide();
            $('.content-info').hide();
            $('.content-iframe').show()
        },

        showErrorContent: function (message, tip, error = null) {
            $('#content-error-message').text(message);
            $('#content-error-tip').text(tip);
            $('#content-error-content').text(error);

            // switch the content view
            $('.content-tip').hide();
            $('.content-error').show();
            $('.content-info').hide();
            $('.content-iframe').hide()
        },

        clean: function () {
            // clean info
            $('#info-header-project').empty();
            $('#info-header-env').empty();
            $('#info-header-state').empty();
            $('#info-details-created-at').empty();
            $('#info-details-project').empty();
            $('#info-details-stack').empty();
            $('#info-details-resource-counter').empty();
            $('#info-outputs').empty();

            // clean iframe
            $('#iframe-file-content').removeAttr('src');
        }
    }
};

const utils = {
    uniqueEntries: function (list) {
        // leave only unique entries
        return list.filter((value, index, self) => self.indexOf(value) === index);
    },

    date: {
        convertIsoDateToHumanReadable: function (isoFormattedDate) {
            // convert ISO date "2023-06-30T15:23:59.556574+03:00" format into "2023-06-30 15:23:59 +03:00" format
            let isoDate = new Date(isoFormattedDate);

            let year = isoDate.getFullYear();
            let month = String(isoDate.getMonth() + 1).padStart(2, '0'); // Month starts from 0 in JS
            let date = String(isoDate.getDate()).padStart(2, '0');
            let hours = String(isoDate.getHours()).padStart(2, '0');
            let minutes = String(isoDate.getMinutes()).padStart(2, '0');
            let seconds = String(isoDate.getSeconds()).padStart(2, '0');

            let timeZoneOffsetSign = isoDate.getTimezoneOffset() < 0 ? '+' : '-';
            let timeZoneOffsetHour = String(Math.abs(isoDate.getTimezoneOffset() / 60)).padStart(2, '0');
            let timeZoneOffsetMinutes = String(Math.abs(isoDate.getTimezoneOffset() % 60)).padStart(2, '0');

            return `${year}-${month}-${date} ${hours}:${minutes}:${seconds} ${timeZoneOffsetSign}${timeZoneOffsetHour}:${timeZoneOffsetMinutes}`;
        },

        convertStateDateToHumanReadable: function (stateDate) {
            // convert "2023-06-30_15-23" format into "2023-06-30 15:23" format
            return stateDate.replace("_", " ").replace(/-([^-]*)$/,':$1');
        }
    },

    pulumi: {
        countResources: function (stateJson) {
            let resources = stateJson.deployment.resources;
            let counter = 0;
            for (let resource of resources) {
                if (resource.custom === true) {
                    counter++;
                }
            }
            return counter;
        },

        getStackOutputs: function (stateJson) {
            let resources = stateJson.deployment.resources;
            for (let resource of resources) {
                if (resource.type === "pulumi:pulumi:Stack") {
                    return resource.outputs;
                }
            }
            return null;
        }
    }
};
