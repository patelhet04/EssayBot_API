# python/analyze_excel.py
import sys
import json
import argparse
import pandas as pd
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def analyze_file(file_path):
    """
    Analyze an Excel file and return information about its structure
    """
    try:
        # Determine file type by extension
        if file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)

        # Check for required columns
        has_response = 'response' in df.columns
        has_student_id = any(
            col.lower() in ['student_id', 'id', 'student id'] for col in df.columns)

        # Calculate word counts for preview
        preview_data = []
        if 'response' in df.columns:
            for i, row in df.head(5).iterrows():
                student_id = row.get(
                    'student_id', row.get('id', f'Student_{i}'))
                response = str(row.get('response', ''))
                word_count = len(response.split())
                excerpt = response[:100] + \
                    '...' if len(response) > 100 else response

                preview_data.append({
                    'student_id': student_id,
                    'word_count': word_count,
                    'excerpt': excerpt
                })

        result = {
            'total_rows': len(df),
            'columns': list(df.columns),
            'has_response': has_response,
            'has_student_id': has_student_id,
            'preview_data': preview_data
        }

        logger.info(f"Successfully analyzed Excel file: {file_path}")
        logger.info(f"Found {len(df)} rows and {len(df.columns)} columns")

        return result

    except Exception as e:
        logger.error(f"Error analyzing Excel file: {str(e)}")
        return {
            'error': str(e)
        }


def main():
    parser = argparse.ArgumentParser(
        description='Analyze Excel file structure')
    parser.add_argument('--file', required=True, help='Path to Excel file')
    args = parser.parse_args()

    result = analyze_file(args.file)

    # Make sure logging doesn't interfere with JSON output
    logging.getLogger().handlers = []  # Remove all handlers

    # Print clean JSON only to stdout
    print(json.dumps(result))


if __name__ == '__main__':
    main()
