export default function ResultsTable({ rows }: any) {

    return (
      <table border={1}>
  
        <thead>
          <tr>
            <th>Site</th>
            <th>pH</th>
            <th>Water Table</th>
          </tr>
        </thead>
  
        <tbody>
  
          {rows.slice(0, 20).map(
            (row: any, idx: number) => (
  
              <tr key={idx}>
                <td>{row.sitename}</td>
                <td>{row.pH}</td>
                <td>{row.water_table_depth}</td>
              </tr>
  
            )
          )}
  
        </tbody>
  
      </table>
    );
  }