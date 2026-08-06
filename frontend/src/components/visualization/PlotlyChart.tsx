import Plotly from "plotly.js/lib/core";
import scatter from "plotly.js/lib/scatter";
import scattergl from "plotly.js/lib/scattergl";
import scatter3d from "plotly.js/lib/scatter3d";
import createPlotlyComponent from "react-plotly.js/factory";

Plotly.register([scatter, scattergl, scatter3d]);

export default createPlotlyComponent(Plotly);
