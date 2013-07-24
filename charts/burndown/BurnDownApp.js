(function () {
    var Ext = window.Ext4 || window.Ext;

    Ext.define("Rally.apps.charts.burndown.BurnDownApp", {
        extend: "Rally.app.TimeboxScopedApp",

        settingsScope: "workspace",

        requires: [
            "Rally.apps.charts.burndown.BurnDownSettings",
            "Rally.data.WsapiDataStore",
            "Rally.ui.combobox.IterationComboBox",
            "Rally.ui.combobox.ReleaseComboBox"
        ],

        mixins: [
            "Rally.apps.charts.DateMixin",
            "Rally.apps.charts.burndown.BurnDownChart"
        ],

        cls: "burndown-app",

        scopedDashboard: false,
        scopeObject: undefined,

        getSettingsFields: function () {
            this.chartSettings = this.chartSettings || Ext.create("Rally.apps.charts.burndown.BurnDownSettings", {
                app: this
            });

            return this.chartSettings.getFields();
        },

        isOnScopedDashboard: function () {
            return this.scopedDashboard;
        },

        onScopeChange: function (scope) {
            this._updateScopeSetting(scope);
            this._saveScopeValue(scope);
            this._destroyChart();
            this._loadScopeObject(this._getRefFromPicker(scope));
        },

        launch: function () {
            if (this._settingsInvalid()) {
                this.owner.showSettings();
                return;
            }

            this._saveDashboardType();
            this.callParent(arguments);

            if (this.isOnScopedDashboard()) {
                this._loadScopeObject(this._getScopeRef());
            } else {
                this._getScopePicker().on("ready", this._loadScopeValue, this);
                this._getScopePicker().on("change", this._saveScopeValue, this);
            }
        },

        _destroyChart: function () {
            var currentChart = this.down("rallychart");
            if (currentChart) {
                currentChart.destroy();
            }
        },

        _updateScopeSetting: function (picker) {
            Ext.apply(this.settings, this._getSettingFromPicker(picker));
        },

        _saveScopeValue: function (picker) {
            Rally.data.PreferenceManager.update({
                appID: this.getContext().get("appID"),
                settings: this._getSettingFromPicker(picker),
                scope: this
            });
        },

        _loadScopeValue: function (picker) {
            Rally.data.PreferenceManager.load({
                appID: this.getContext().get("appID"),
                success: function (loadedSettings) {
                    var settingValue = loadedSettings[this._getScopeType()];
                    if (!settingValue || settingValue === "undefined") {
                        this._saveScopeValue(picker);
                        settingValue = this._getRefFromPicker(picker);
                    }

                    this._setScopeValue(settingValue);
                    this._loadScopeObject(settingValue);
                },
                scope: this
            });
        },

        _setScopeValue: function (value) {
            this._getScopePicker().setValue(value);
        },

        _onScopeObjectLoaded: function (store) {
            if (this._hasDataToDisplay(store)) {
                this._setScopeFromData(store);

                this._updateChartTitle();
                this._updateYAxis();

                this._addDateBounds();
                this._addAggregationTypeToCalculator();
                this._updateCompletedScheduleStates();

                var timeboxStore = Ext.create("Rally.data.WsapiDataStore", {
                    model: this.scopeObject._type,
                    filters: [
                        {
                            property: "Name",
                            operator: "=",
                            value: this.scopeObject.Name
                        },
                        {
                            property: this._getScopeObjectStartDateName(),
                            operator: "=",
                            value: this._getScopeObjectStartDate().toISOString()
                        },
                        {
                            property: this._getScopeObjectEndDateName(),
                            operator: "=",
                            value: this._getScopeObjectEndDate().toISOString()
                        }
                    ],
                    context: {
                        workspace: this.getContext().getWorkspaceRef(),
                        project: this.getContext().getProjectRef()
                    },
                    scope: this
                });

                timeboxStore.on("load", this._getTimeboxesInScope, this);
                timeboxStore.load();
            }
        },

        _renderChartBasedOnType: function () {
            if (this._getScopeType() === "release") {
                this._fetchIterations();
            } else {
                this._addChart();
            }
        },

        _setScopeFromData: function (store) {
            this.scopeObject = store.getAt(0).data;
        },

        _hasDataToDisplay: function (store) {
            return store.count() >= 1;
        },

        _getTimeboxesInScope: function (store) {
            this.timeboxes = store.getItems();
            var storeConfig = this.chartComponentConfig.storeConfig,
                type = Ext.String.capitalize(this._getScopeType());
            this._clearStoreConfig(storeConfig);
            var oids = [];
            for (var i = 0; i < this.timeboxes.length; i++) {
                oids.push(this.timeboxes[i].ObjectID);
            }
            storeConfig.find[type] = { "$in" : oids };

            this._renderChartBasedOnType();

        },

        _onIterationsLoaded: function (store) {
            this.iterations = store.getItems();

            this._addChart();
            this.down("rallychart").on("snapshotsAggregated", this._addIterationLines, this);
        },

        _addDateBounds: function () {
            this._addDateBoundsToQuery();
            this._addDateBoundsToCalculator();
        },

        _addDateBoundsToQuery: function () {

        },

        _addDateBoundsToCalculator: function () {
            var calcConfig = this.chartComponentConfig.calculatorConfig;
            calcConfig.startDate = this.dateToString(this._getScopeObjectStartDate());
            calcConfig.endDate = this.dateToString(this._getScopeObjectEndDate());
        },

        _addAggregationTypeToCalculator: function () {
            var calcConfig = this.chartComponentConfig.calculatorConfig;
            calcConfig.chartAggregationType = this.getSetting("chartAggregationType");
        },

        _updateCompletedScheduleStates: function () {
            var calcConfig = this.chartComponentConfig.calculatorConfig;
            calcConfig.completedScheduleStateNames = this._getCompletedScheduleStates();
        },

        _loadScopeObject: function (ref) {
            Ext.create("Rally.data.WsapiDataStore", {
                model: this._getScopeType(),
                filters: [
                    {
                        property: "ObjectID",
                        operator: "=",
                        value: Rally.util.Ref.getOidFromRef(ref)
                    }
                ],
                context: {
                    workspace: this.getContext().getWorkspaceRef(),
                    project: null
                },
                autoLoad: true,
                listeners: {
                    load: this._onScopeObjectLoaded,
                    scope: this
                }
            });
        },

        _fetchIterations: function () {
            var store = Ext.create("Rally.data.WsapiDataStore", {
                model: "Iteration",
                filters: [
                    {
                        property: "StartDate",
                        operator: ">=",
                        value: this.dateToString(this._getScopeObjectStartDate())
                    },
                    {
                        property: "EndDate",
                        operator: "<=",
                        value: this.dateToString(this._getScopeObjectEndDate())
                    }
                ],
                context: {
                    workspace: this.getContext().getWorkspaceRef(),
                    project: this.getContext().getProjectRef()
                },
                scope: this
            });

            store.on("load", this._onIterationsLoaded, this);
            store.load();
        },

        _addIterationLines: function (chart) {
            var axis = chart.chartConfig.xAxis,
                categories = chart.chartData.categories;

            axis.plotLines = [];
            axis.plotBands = [];

            for (var i = 0; i < this.iterations.length; i++) {
                axis.plotLines.push(this._getPlotLine(categories, this.iterations[i], false));
                axis.plotBands.push(this._getPlotBand(categories, this.iterations[i], i % 2 !== 0));
            }

            if (this.iterations.length > 0) {
                axis.plotLines.push(this._getPlotLine(categories, this.iterations[this.iterations.length - 1], true));
            }
        },

        _getPlotBand: function (categories, iteration, shouldColorize) {
            var startDate = this.dateStringToObject(iteration.StartDate),
                endDate = this.dateStringToObject(iteration.EndDate);

            var startDateStr = Ext.Date.format(startDate, "Y-m-d"),
                endDateStr = Ext.Date.format(endDate, "Y-m-d");

            return {
                color: shouldColorize ? "#F2FAFF" : "#FFFFFF",
                from: categories.indexOf(startDateStr),
                to: categories.indexOf(endDateStr),
                label: {
                    text: iteration.Name,
                    align: "center",
                    rotation: 0,
                    y: -7
                }
            };
        },

        _getPlotLine: function (categories, iteration, lastLine) {
            var dateObj;

            if (lastLine) {
                dateObj = this.dateStringToObject(iteration.EndDate);
            } else {
                dateObj = this.dateStringToObject(iteration.StartDate);
            }

            var dateStr = Ext.Date.format(dateObj, "Y-m-d");
            var dateIndex = categories.indexOf(dateStr);

            return {
                color: "#BBBBBB",
                dashStyle: "ShortDash",
                width: 2,
                zIndex: 3,
                value: dateIndex
            };
        },

        _addChart: function () {
            this.chartComponentConfig = Ext.Object.merge({}, this.chartComponentConfig);

            this.add(this.chartComponentConfig);
            this.down("rallychart").on("snapshotsAggregated", this._onSnapshotDataReady, this);
        },

        _onSnapshotDataReady: function (chart) {
            this._updateDisplayType(chart);
        },

        _updateDisplayType: function (chart) {
            var series = chart.chartData.series,
                displayType = this.getSetting("chartDisplayType");

            for (var i = 0; i < series.length; i++) {
                if (this._seriesFollowsDisplayType(series[i])) {
                    series[i].type = displayType;
                }
            }
        },

        _seriesFollowsDisplayType: function (series) {
            return series.name.indexOf("Ideal") === -1 && series.name.indexOf("Task To Do Prediction") === -1;
        },

        _updateYAxis: function () {
            this._updateYAxisTitle();
            this._updateYAxisConfig();
        },

        _updateYAxisTitle: function () {
            var chartConfig = this.chartComponentConfig.chartConfig;
            chartConfig.yAxis = [
                {}
            ];
            chartConfig.yAxis[0].title = {
                text: this._getAxisTitleBasedOnAggregationType()
            };
        },

        _updateYAxisConfig: function () {
            var axis = this.chartComponentConfig.chartConfig.yAxis[0];
            axis.min = 0;
            axis.labels = {
                x: -5,
                y: 4
            };
        },

        _getAxisTitleBasedOnAggregationType: function () {
            var aggregationType = this.getSetting("chartAggregationType");
            if (aggregationType === "storycount") {
                return "Count";
            } else {
                return "Points";
            }
        },

        _updateChartTitle: function () {
            var chartConfig = this.chartComponentConfig.chartConfig;
            chartConfig.title = this._buildChartTitle();
        },

        _buildChartTitle: function () {
            var widthPerCharacter = 10,
                totalCharacters = Math.floor(this.getWidth() / widthPerCharacter),
                title = this._getDefaultTitle(),
                align = "center";

            if (this.scopeObject) {
                title = this.scopeObject.Name;
            }

            if (totalCharacters < title.length) {
                title = title.substring(0, totalCharacters) + "...";
                align = "left";
            }

            return {
                text: title,
                align: align,
                margin: 30
            };
        },

        _getDefaultTitle: function () {
            return Ext.String.capitalize(this._getScopeType());
        },

        _getSettingFromPicker: function (picker) {
            var settings = {};
            settings[this._getScopeType()] = this._getRefFromPicker(picker);
            return settings;
        },

        _getRefFromPicker: function (picker) {
            var data = picker.getRecord().data;
            if(data !== "undefined") {
                return picker.getRecord().data._ref;
            }
            else {
                return null;
            }
        },

        _getScopeRef: function () {
            return this._getRefFromPicker(this._getScopePicker());
        },

        _settingsInvalid: function () {
            var chartAggregationType = this.getSetting("chartAggregationType"),
                chartDisplayType = this.getSetting("chartDisplayType"),
                chartTimebox = this.getSetting("chartTimebox");

            var invalid = function (value) {
                return !value || value === "undefined";
            };

            return invalid(chartAggregationType) || invalid(chartDisplayType) || this._chartTimeboxInvalid(chartTimebox);
        },

        _chartTimeboxInvalid: function (chartTimebox) {
            if (this.context.getTimeboxScope()) {
                return false;
            }

            return !chartTimebox || chartTimebox === "undefined";
        },

        _saveDashboardType: function () {
            var context = this.getContext();
            this.scopedDashboard = !!(context && context.getTimeboxScope());
            this.scopeType = this._getScopeType();
        },

        _getScopeType: function () {
            if (this.isOnScopedDashboard()) {
                return this._getDashboardScopeType();
            } else {
                return this._getSavedScopeType();
            }
        },

        _getDashboardScopeType: function () {
            return this.getContext().getTimeboxScope().getType();
        },

        _getSavedScopeType: function () {
            return this.getSetting("chartTimebox");
        },

        _getScopePicker: function () {
            if (this.isOnScopedDashboard()) {
                return this.getContext().getTimeboxScope();
            } else {
                return this.down("rally" + this._getScopeType() + "combobox");
            }
        },

        _getScopeObjectStartDateName: function () {
            if (!this.scopeObject) {
                return "";
            } else if (this.scopeObject._type === "release") {
                return "ReleaseStartDate";
            } else {
                return "StartDate";
            }
        },

        _getScopeObjectEndDateName: function () {
            if (!this.scopeObject) {
                return "";
            } else if (this.scopeObject._type === "release") {
                return "ReleaseDate";
            } else {
                return "EndDate";
            }
        },

        _getScopeObjectStartDate: function () {
            if (!this.scopeObject) {
                return new Date();
            } else if (this.scopeObject._type === "release") {
                return this.scopeObject.ReleaseStartDate;
            } else {
                return this.scopeObject.StartDate;
            }
        },

        _getScopeObjectEndDate: function () {
            if (!this.scopeObject) {
                return new Date();
            } else if (this.scopeObject._type === "release") {
                return this.scopeObject.ReleaseDate;
            } else {
                return this.scopeObject.EndDate;
            }
        },

        _clearStoreConfig: function (storeConfig) {
            if (storeConfig.find.hasOwnProperty("Release")) {
                delete storeConfig.find.Release;
            }

            if (storeConfig.find.hasOwnProperty("Iteration")) {
                delete storeConfig.find.Iteration;
            }
        },

        _getCompletedScheduleStates: function () {
            var states = this.getSetting("customScheduleStates");
            if(_.isString(states)) {
                return states.split(",");
            }
            // return reasonable defaults, unless they have a state called Released that comes before Accepted...sigh.
            return ["Accepted", "Released"];
        }

    });
}());
