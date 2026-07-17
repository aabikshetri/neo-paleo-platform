import Plotly from "plotly.js/lib/core";
import scatter from "plotly.js/lib/scatter";
import scatter3d from "plotly.js/lib/scatter3d";
import createPlotlyComponent from "react-plotly.js/factory";

Plotly.register([scatter, scatter3d]);

export default createPlotlyComponent(Plotly);
